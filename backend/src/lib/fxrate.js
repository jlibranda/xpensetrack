// src/lib/fxrate.js
// Keeps the USD -> PHP rate up to date.
//
// BSP does not publish a clean free JSON API, so we use a free FX feed
// (open.er-api.com, no key required) which tracks the market rate closely.
// An admin can switch to manual mode and enter the exact BSP reference rate;
// when in manual mode, auto-fetch will not overwrite it.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FALLBACK_RATE = 56;

async function getOrg() {
  let s = await prisma.orgSettings.findFirst();
  if (!s) s = await prisma.orgSettings.create({ data: {} });
  return s;
}

// Returns the current USD->PHP rate to use for conversions.
async function getUsdPhpRate() {
  try {
    const s = await getOrg();
    return s.usdPhpRate || FALLBACK_RATE;
  } catch (e) {
    return FALLBACK_RATE;
  }
}

// Fetch the latest rate from the free FX feed and store it,
// UNLESS the org has switched to manual mode.
async function refreshUsdPhpRate() {
  try {
    const s = await getOrg();
    if (!s.usdPhpRateAuto) {
      return { rate: s.usdPhpRate, auto: false, skipped: 'manual mode' };
    }
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!resp.ok) throw new Error(`FX feed HTTP ${resp.status}`);
    const data = await resp.json();
    const php = data?.rates?.PHP;
    if (!php || typeof php !== 'number') throw new Error('PHP rate missing from feed');

    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: { usdPhpRate: php, usdPhpRateUpdatedAt: new Date() },
    });
    console.log(`[fxrate] USD->PHP updated to ${php}`);
    return { rate: updated.usdPhpRate, auto: true, updatedAt: updated.usdPhpRateUpdatedAt };
  } catch (e) {
    console.error('[fxrate] refresh failed:', e.message);
    return { error: e.message };
  }
}

// Start a periodic refresh (every 12 hours) plus one on startup.
function startFxRefresh() {
  // Initial refresh shortly after boot (don't block startup).
  setTimeout(() => { refreshUsdPhpRate(); }, 5000);
  // Then every 12 hours.
  setInterval(() => { refreshUsdPhpRate(); }, 12 * 60 * 60 * 1000);
}

module.exports = { getUsdPhpRate, refreshUsdPhpRate, startFxRefresh, FALLBACK_RATE };
