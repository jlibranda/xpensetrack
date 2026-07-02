// src/lib/fxrate.js
// Keeps the USD -> PHP rate up to date, sourced from the Bangko Sentral ng Pilipinas (BSP).
//
// PRIMARY: BSP "Buying Rate (T/T): PHP" parsed from the daily Reference Exchange
//   Rate Bulletin (RERB) Excel file — a stable URL that always points to the
//   current day's bulletin:  https://www.bsp.gov.ph/Statistics/RERB/RERB.xlsx
// FALLBACK 1: BSP official "Daily Peso per US Dollar" reference rate (HTML table).
// FALLBACK 2: a free market feed (open.er-api.com), also used as a sanity cross-check.
//
// An admin can switch to MANUAL mode and type an exact rate; manual mode is never
// overwritten by the auto-fetch.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');

const FALLBACK_RATE = 56;
const RERB_XLSX_URL = 'https://www.bsp.gov.ph/Statistics/RERB/RERB.xlsx';
const DAY99_URL = 'https://www.bsp.gov.ph/statistics/external/day99_data.aspx';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; XpenseTrack/1.0)' };

async function getOrg() {
  let s = await prisma.orgSettings.findFirst();
  if (!s) s = await prisma.orgSettings.create({ data: {} });
  return s;
}

async function getUsdPhpRate() {
  try { const s = await getOrg(); return s.usdPhpRate || FALLBACK_RATE; }
  catch (e) { return FALLBACK_RATE; }
}

// Parse the RERB.xlsx and return the "BSP Buying Rate (T/T): PHP" value.
async function fetchBspTtBuyingRate() {
  const resp = await fetch(RERB_XLSX_URL, { headers: UA });
  if (!resp.ok) throw new Error(`RERB HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const wanted = /buying\s*rate\s*\(\s*t\s*\/\s*t\s*\)/i; // "Buying Rate (T/T)"
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false });
    for (const row of grid) {
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (typeof cell !== 'string' || !wanted.test(cell)) continue;
        // Value usually sits in the next cell(s) on the same row.
        for (let k = c + 1; k < row.length; k++) {
          const v = parseFloat(String(row[k]).replace(/[^\d.]/g, ''));
          if (!isNaN(v) && v > 30 && v < 100) return v;
        }
        // Or it may be embedded in the same cell: "BSP Buying Rate (T/T): PHP 58.450"
        const inline = cell.match(/(\d{2}\.\d{2,4})/);
        if (inline) { const v = parseFloat(inline[1]); if (v > 30 && v < 100) return v; }
      }
    }
  }
  throw new Error('Buying Rate (T/T) not found in RERB');
}

// Fallback: BSP "Daily Peso per US Dollar" reference rate (latest day, current month column).
async function fetchBspUsdPhp() {
  const resp = await fetch(DAY99_URL, { headers: UA });
  if (!resp.ok) throw new Error(`BSP HTTP ${resp.status}`);
  const html = await resp.text();
  const rows = html.split(/<\/tr>/i);
  let targetIndex = null, latest = null;
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim());
    if (!cells.length) continue;
    if (targetIndex === null) { if (/date/i.test(cells[0]) && cells.length > 2) targetIndex = cells.length - 1; continue; }
    if (!/^\d{1,2}$/.test(cells[0])) continue;
    if (cells.length <= targetIndex) continue;
    const n = parseFloat(cells[targetIndex]);
    if (cells[targetIndex] && !isNaN(n) && n > 30 && n < 100) latest = n;
  }
  if (!latest) throw new Error('BSP daily rate not found on page');
  return latest;
}

async function refreshUsdPhpRate() {
  try {
    const s = await getOrg();
    if (!s.usdPhpRateAuto) return { rate: s.usdPhpRate, auto: false, skipped: 'manual mode' };

    // Market feed (sanity cross-check + last-resort fallback).
    let market = null;
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      if (r.ok) { const d = await r.json(); if (typeof d?.rates?.PHP === 'number') market = d.rates.PHP; }
    } catch (e) { /* ignore */ }

    // BSP T/T buying rate (primary).
    let bspTt = null;
    try { bspTt = await fetchBspTtBuyingRate(); } catch (e) { console.error('[fxrate] RERB T/T failed:', e.message); }

    // BSP reference rate (fallback) only if T/T unavailable.
    let bspRef = null;
    if (bspTt == null) { try { bspRef = await fetchBspUsdPhp(); } catch (e) { console.error('[fxrate] BSP day99 failed:', e.message); } }

    const sane = (v) => v != null && (!market || Math.abs(v - market) / market < 0.08);

    let rate = null, source = null;
    if (sane(bspTt)) { rate = bspTt; source = 'BSP Buying Rate (T/T)'; }
    else if (sane(bspRef)) { rate = bspRef; source = 'BSP Reference Rate'; }
    else if (market) { rate = market; source = 'market-feed'; }
    else if (bspTt != null) { rate = bspTt; source = 'BSP Buying Rate (T/T)'; }
    else if (bspRef != null) { rate = bspRef; source = 'BSP Reference Rate'; }
    if (rate == null) throw new Error('no rate from BSP or market feed');

    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: { usdPhpRate: rate, usdPhpRateUpdatedAt: new Date() },
    });
    console.log(`[fxrate] USD->PHP updated to ${rate} (source: ${source})`);
    return { rate: updated.usdPhpRate, auto: true, source, updatedAt: updated.usdPhpRateUpdatedAt };
  } catch (e) {
    console.error('[fxrate] refresh failed:', e.message);
    return { error: e.message };
  }
}

function startFxRefresh() {
  const { runIfDue } = require('./scheduler-lock');
  const INTERVAL = 12 * 60 * 60 * 1000; // real cadence: every 12h (enforced across replicas)
  const CHECK = 30 * 60 * 1000;         // each replica checks every 30 min
  setTimeout(() => { runIfDue('fx_refresh', INTERVAL, refreshUsdPhpRate); }, 8000);
  setInterval(() => { runIfDue('fx_refresh', INTERVAL, refreshUsdPhpRate); }, CHECK);
}

module.exports = { getUsdPhpRate, refreshUsdPhpRate, startFxRefresh, fetchBspTtBuyingRate, fetchBspUsdPhp, FALLBACK_RATE };
