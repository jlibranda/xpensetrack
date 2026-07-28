// src/routes/settings.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole, requirePermission, hasPermission } = require('../middleware/auth');
const multer = require('multer');
const prisma = new PrismaClient();
const { refreshUsdPhpRate, getUsdPhpRate } = require('../lib/fxrate');
const { logAudit } = require('../lib/audit');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const NEW_DEFAULT_CATEGORIES = "Cleaning,Education and Training,Entertainment/Meals,Equipment,Facility Maintenance and Repair,Furniture and Fixtures,General Office Expense,Hardware,Miscellaneous,Mobile Device,Non-Capital Small Tools Equipment and Furniture,Office Rent,Parking,Printing,Recruiting,Travel - Air Ticket (International),Travel - Air Ticket (Domestic),Travel - Others,Travel - Hotel (Domestic)";

async function getOrCreate() {
  let s = await prisma.orgSettings.findFirst();
  if (!s) {
    // Brand-new install: seed the starter category list ONCE. After this point the
    // org's list is never auto-modified — deleting some or even ALL categories is
    // respected. Defaults can be restored intentionally via POST /settings/reset-categories.
    s = await prisma.orgSettings.create({ data: { categories: NEW_DEFAULT_CATEGORIES } });
  }
  return s;
}

function parseSettings(s) {
  let glCodes = {};
  try { glCodes = JSON.parse(s.categoryGlCodes || '{}'); } catch(e) {}
  let categoryTypes = {};
  try { categoryTypes = JSON.parse(s.categoryTypes || '{}'); } catch(e) {}
  let accessControl = {};
  try { accessControl = JSON.parse(s.accessControlJson || '{}'); } catch(e) {}
  let emailTemplates = {};
  try { emailTemplates = JSON.parse(s.emailTemplatesJson || '{}'); } catch(e) {}
  let payoutReversalUserIds = [];
  try { payoutReversalUserIds = JSON.parse(s.payoutReversalUserIds || '[]'); } catch(e) {}
  let vendors = [];
  try { vendors = JSON.parse(s.vendors || '[]'); } catch(e) {}
  let atcCodes = [];
  try { atcCodes = JSON.parse(s.atcCodes || '[]'); } catch(e) {}
  return {
    ...s,
    categories: s.categories.split(',').map(c => c.trim()).filter(Boolean),
    expenseTypes: s.expenseTypes.split(',').map(t => t.trim()).filter(Boolean),
    categoryGlCodes: glCodes,
    categoryTypes,
    accessControl,
    emailTemplates,
    payoutReversalUserIds,
    vendors,
    atcCodes,
  };
}

router.get('/', authenticate, async (req, res) => {
  try { res.json(parseSettings(await getOrCreate())); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/', authenticate, async (req, res) => {
  try {
    const { companyName, defaultCurrency, receiptRequiredAbove, approvalLevels,
            primaryColor, categories, expenseTypes, categoryGlCodes, categoryTypes, defaultPassword, darkMode,
            wallpaperStyle, autoReapplyApprovalFlow, tin, accessControl, emailTemplates,
            loginMaxAttempts, loginLockoutMinutes, payoutReversalUserIds, emailNotificationsEnabled, timezone, approvalFollowUpDays, vendors,
            companyAddress, companyZip, signatoryName, signatoryTitle, signatoryTin, atcCodes } = req.body;
    const s = await getOrCreate();
    // Field-level permission: apply each group only if the user is allowed.
    const canCats = await hasPermission(req.user, 'edit_categories', ['FINANCE', 'ADMIN']);
    const canBrand = await hasPermission(req.user, 'change_branding', ['ADMIN']);
    const canManage = await hasPermission(req.user, 'manage_settings', ['FINANCE', 'ADMIN']);
    const canExpTypes = await hasPermission(req.user, 'manage_expense_types', ['FINANCE', 'ADMIN']);
    const canPassword = await hasPermission(req.user, 'manage_password', ['ADMIN']);
    const canAccessCtrl = await hasPermission(req.user, 'manage_access_control', ['ADMIN']);
    const canSecurity = await hasPermission(req.user, 'manage_security', ['ADMIN']);
    const canApAr = await hasPermission(req.user, 'manage_ap_ar', ['FINANCE', 'ADMIN']);

    // Access-control write: Admin sets anything; a non-admin manager may edit the
    // matrix EXCEPT the 4 sensitive permissions, which are preserved from current.
    let accessControlJson = undefined;
    if (accessControl !== undefined && canAccessCtrl) {
      if (req.user.role === 'ADMIN') {
        accessControlJson = JSON.stringify(accessControl);
      } else {
        const SENSITIVE = ['manage_password', 'reset_passwords', 'upload_branding', 'change_branding', 'impersonate_user'];
        let existing = {};
        try { existing = s.accessControlJson ? JSON.parse(s.accessControlJson) : {}; } catch (e) { existing = {}; }
        const merged = { ...accessControl };
        for (const k of SENSITIVE) merged[k] = existing[k] || ['ADMIN'];
        accessControlJson = JSON.stringify(merged);
      }
    }

    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: {
        companyName: canManage ? companyName : undefined,
        defaultCurrency: canManage ? defaultCurrency : undefined,
        receiptRequiredAbove: canManage && receiptRequiredAbove ? Number(receiptRequiredAbove) : undefined,
        approvalLevels: canManage && approvalLevels ? Number(approvalLevels) : undefined,
        primaryColor: canBrand ? primaryColor : undefined,
        darkMode: canManage ? darkMode : undefined,
        wallpaperStyle: canBrand ? (wallpaperStyle || undefined) : undefined,
        autoReapplyApprovalFlow: canManage && typeof autoReapplyApprovalFlow === 'boolean' ? autoReapplyApprovalFlow : undefined,
        tin: canManage && tin !== undefined ? (tin || null) : undefined,
        categories: canCats ? (Array.isArray(categories) ? categories.join(',') : categories) : undefined,
        expenseTypes: canExpTypes ? (Array.isArray(expenseTypes) ? expenseTypes.join(',') : expenseTypes) : undefined,
        categoryGlCodes: canCats ? (categoryGlCodes ? JSON.stringify(categoryGlCodes) : undefined) : undefined,
        categoryTypes: canCats && categoryTypes !== undefined ? JSON.stringify(categoryTypes || {}) : undefined,
        defaultPassword: canPassword ? (defaultPassword || undefined) : undefined,
        accessControlJson,
        emailTemplatesJson: canManage && emailTemplates !== undefined ? JSON.stringify(emailTemplates) : undefined,
        loginMaxAttempts: canSecurity && loginMaxAttempts !== undefined ? Math.max(0, parseInt(loginMaxAttempts, 10) || 0) : undefined,
        loginLockoutMinutes: canSecurity && loginLockoutMinutes !== undefined ? Math.max(1, parseInt(loginLockoutMinutes, 10) || 1) : undefined,
        payoutReversalUserIds: canSecurity && payoutReversalUserIds !== undefined ? JSON.stringify(Array.isArray(payoutReversalUserIds) ? payoutReversalUserIds : []) : undefined,
        emailNotificationsEnabled: canManage && typeof emailNotificationsEnabled === 'boolean' ? emailNotificationsEnabled : undefined,
        timezone: canManage && timezone ? timezone : undefined,
        approvalFollowUpDays: canManage && approvalFollowUpDays !== undefined ? Math.max(0, parseInt(approvalFollowUpDays, 10) || 0) : undefined,
        vendors: (canApAr || canManage) && vendors !== undefined ? JSON.stringify(Array.isArray(vendors) ? vendors.filter(v => v && v.name).map(v => ({ name: String(v.name).trim(), tin: v.tin ? String(v.tin).trim() : undefined, type: ['COMPANY','GOVERNMENT','LGU'].includes(v.type) ? v.type : 'COMPANY', contactPerson: v.contactPerson ? String(v.contactPerson).trim() : undefined, email: v.email ? String(v.email).trim() : undefined, address: v.address ? String(v.address).trim() : undefined, zip: v.zip ? String(v.zip).trim() : undefined })) : []) : undefined,
        companyAddress: canManage && companyAddress !== undefined ? (companyAddress || null) : undefined,
        companyZip: canManage && companyZip !== undefined ? (companyZip || null) : undefined,
        signatoryName: canManage && signatoryName !== undefined ? (signatoryName || null) : undefined,
        signatoryTitle: canManage && signatoryTitle !== undefined ? (signatoryTitle || null) : undefined,
        signatoryTin: canManage && signatoryTin !== undefined ? (signatoryTin || null) : undefined,
        atcCodes: (canApAr || canManage) && atcCodes !== undefined ? JSON.stringify(Array.isArray(atcCodes) ? atcCodes.filter(a => a && a.code).map(a => ({ code: String(a.code).trim(), description: a.description ? String(a.description).trim() : '', rate: Number(a.rate) || 0 })) : []) : undefined,
      },
    });
    res.json(parseSettings(updated));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/logo', authenticate, requirePermission('upload_branding', ['ADMIN']), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { logoUrl: base64 } });
    res.json({ logoUrl: base64 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/wallpaper', authenticate, requirePermission('upload_branding', ['ADMIN']), upload.single('wallpaper'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { wallpaperUrl: base64 } });
    res.json({ wallpaperUrl: base64 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/wallpaper', authenticate, requirePermission('upload_branding', ['ADMIN']), async (req, res) => {
  try {
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { wallpaperUrl: null } });
    res.json({ message: 'Wallpaper removed' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


// GET /api/settings/logo — public, serves the org logo as a real image so it can
// be embedded in emails (data-URI logos are blocked by most email clients).
router.get('/logo', async (req, res) => {
  try {
    const s = await prisma.orgSettings.findFirst();
    const logo = s?.logoUrl;
    if (!logo) return res.status(404).end();
    if (/^https?:\/\//i.test(logo)) return res.redirect(logo);
    const m = /^data:([^;]+);base64,(.*)$/i.exec(logo);
    if (!m) return res.status(404).end();
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', m[1] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.end(buf);
  } catch (err) { return res.status(404).end(); }
});

// GET /api/settings/public — no auth required, returns branding only
router.get('/public', async (req, res) => {
  try {
    const s = await getOrCreate();
    res.json({
      companyName: s.companyName,
      primaryColor: s.primaryColor,
      logoUrl: s.logoUrl,
      wallpaperUrl: s.wallpaperUrl,
      tin: s.tin,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


// POST /api/settings/reset-categories — force reset to new default categories
router.post('/reset-categories', authenticate, requirePermission('edit_categories', ['FINANCE','ADMIN']), async (req, res) => {
  try {
    const s = await getOrCreate();
    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: { categories: NEW_DEFAULT_CATEGORIES }
    });
    res.json({ message: 'Categories reset to defaults', categories: updated.categories.split(',') });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/exchange-rate — current USD->PHP rate (any authenticated user)
router.get('/exchange-rate', authenticate, async (req, res) => {
  try {
    const s = await getOrCreate();
    res.json({
      usdPhpRate: s.usdPhpRate || 56,
      auto: s.usdPhpRateAuto,
      updatedAt: s.usdPhpRateUpdatedAt,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/settings/exchange-rate — admin sets manual rate or toggles auto mode
router.patch('/exchange-rate', authenticate, requirePermission('manage_settings', ['FINANCE','ADMIN']), async (req, res) => {
  try {
    const { usdPhpRate, auto } = req.body;
    const s = await getOrCreate();
    const data = {};
    if (typeof auto === 'boolean') data.usdPhpRateAuto = auto;
    if (usdPhpRate !== undefined && usdPhpRate !== null && !isNaN(Number(usdPhpRate))) {
      data.usdPhpRate = Number(usdPhpRate);
      data.usdPhpRateUpdatedAt = new Date();
    }
    const updated = await prisma.orgSettings.update({ where: { id: s.id }, data });
    await logAudit(req.user, 'EXCHANGE_RATE_UPDATED', { targetType: 'SETTINGS', details: `USD→PHP set to ${updated.usdPhpRate} (${updated.usdPhpRateAuto ? 'auto' : 'manual'})` });
    // If they just switched back to auto, fetch a fresh rate immediately.
    if (data.usdPhpRateAuto === true) { refreshUsdPhpRate().catch(() => {}); }
    res.json({ usdPhpRate: updated.usdPhpRate, auto: updated.usdPhpRateAuto, updatedAt: updated.usdPhpRateUpdatedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/exchange-rate/refresh — admin forces an immediate auto-fetch
router.post('/exchange-rate/refresh', authenticate, requirePermission('manage_settings', ['FINANCE','ADMIN']), async (req, res) => {
  try {
    const result = await refreshUsdPhpRate();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ---------------------------------------------------------------------------
// Google Sheet vendor sync: link a sheet (shared as "Anyone with the link —
// Viewer") and pull the Vendors/Payees list from it. MERGE semantics: matched
// by Name (case-insensitive); blank cells never erase existing details.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  // Small quote-aware CSV parser (handles commas/quotes/newlines in cells).
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => String(c).trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => String(c).trim() !== '')) rows.push(row);
  return rows;
}

function gsheetCsvUrl(link) {
  // Accepts a normal Google Sheets link and converts it to the CSV export URL.
  const m = String(link || '').match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gid = (String(link).match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

// Save (or clear) the linked sheet URL.
router.post('/vendors-gsheet', authenticate, async (req, res) => {
  try {
    const canManage = await hasPermission(req.user, 'manage_settings', ['FINANCE', 'ADMIN']);
    if (!canManage) return res.status(403).json({ error: 'Not allowed' });
    const url = String(req.body?.url || '').trim();
    if (url && !gsheetCsvUrl(url)) return res.status(400).json({ error: 'That does not look like a Google Sheets link (docs.google.com/spreadsheets/...).' });
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { vendorSheetUrl: url || null } });
    res.json({ message: url ? 'Google Sheet linked.' : 'Google Sheet unlinked.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pull the vendor list from the linked sheet NOW.
router.post('/vendors-gsheet/sync', authenticate, async (req, res) => {
  try {
    const canManage = await hasPermission(req.user, 'manage_settings', ['FINANCE', 'ADMIN']);
    const canApAr = await hasPermission(req.user, 'manage_ap_ar', ['FINANCE', 'ADMIN']);
    if (!canManage && !canApAr) return res.status(403).json({ error: 'Not allowed' });
    const s = await getOrCreate();
    const csvUrl = gsheetCsvUrl(s.vendorSheetUrl);
    if (!csvUrl) return res.status(400).json({ error: 'No Google Sheet linked yet — paste the sheet link first.' });

    const resp = await fetch(csvUrl, { redirect: 'follow' });
    if (!resp.ok) return res.status(400).json({ error: `Could not read the sheet (HTTP ${resp.status}). Make sure it is shared as "Anyone with the link — Viewer".` });
    const text = await resp.text();
    if (text.trim().startsWith('<')) return res.status(400).json({ error: 'The sheet is not accessible — set sharing to "Anyone with the link — Viewer" and try again.' });

    const grid = parseCsv(text);
    if (grid.length < 2) return res.status(400).json({ error: 'The sheet has no data rows (row 1 must be headers).' });
    const headers = grid[0].map(h => String(h).trim().toLowerCase());
    const col = (...names) => headers.findIndex(h => names.some(n => h === n.toLowerCase()));
    const iName = col('Name', 'Vendor', 'Payee', 'Vendor / payee name');
    if (iName === -1) return res.status(400).json({ error: 'No "Name" column found in row 1. Expected columns: Name, Type, Contact Person, Email, TIN, Registered Address, ZIP.' });
    const iType = col('Type'), iContact = col('Contact Person', 'Contact', 'Contact Name'), iEmail = col('Email', 'Email Address'), iTin = col('TIN'), iAddr = col('Registered Address', 'Address'), iZip = col('ZIP', 'Zip Code');
    const cell = (r, i) => (i === -1 ? '' : String(r[i] ?? '').trim());
    const normType = (t) => { const x = String(t || '').trim().toUpperCase(); return ['COMPANY','GOVERNMENT','LGU'].includes(x) ? x : (x.startsWith('GOV') ? 'GOVERNMENT' : x === 'LGU' ? 'LGU' : 'COMPANY'); };

    let vendors = [];
    try { vendors = JSON.parse(s.vendors || '[]'); } catch { vendors = []; }
    const byName = new Map(vendors.map(v => [String(v.name).toLowerCase(), { ...v }]));
    let added = 0, updated = 0; const skipped = [];
    for (let r = 1; r < grid.length; r++) {
      const rowNo = r + 1;
      const name = cell(grid[r], iName);
      if (!name) { skipped.push({ row: rowNo, reason: 'Name column is empty' }); continue; }
      const emailRaw = cell(grid[r], iEmail);
      const emailList = emailRaw.split(';').map(x => x.trim()).filter(Boolean);
      const badEmail = emailList.find(em => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em));
      if (badEmail) { skipped.push({ row: rowNo, name, reason: `Invalid email: "${badEmail}"` }); continue; }
      const key = name.toLowerCase();
      const prev = byName.get(key);
      const typeRaw = cell(grid[r], iType);
      const rec = {
        name: prev?.name || name,
        type: typeRaw ? normType(typeRaw) : (prev?.type || 'COMPANY'),
        contactPerson: cell(grid[r], iContact) || prev?.contactPerson || '',
        email: emailList.join('; ') || prev?.email || '',
        tin: cell(grid[r], iTin).replace(/\D/g, '') || prev?.tin || '',
        address: cell(grid[r], iAddr) || prev?.address || '',
        zip: cell(grid[r], iZip).replace(/\D/g, '').slice(0, 4) || prev?.zip || '',
      };
      if (prev) updated++; else added++;
      byName.set(key, rec);
    }
    await prisma.orgSettings.update({ where: { id: s.id }, data: { vendors: JSON.stringify(Array.from(byName.values())), vendorSheetSyncedAt: new Date() } });
    res.json({ added, updated, skipped, total: byName.size, syncedAt: new Date() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
