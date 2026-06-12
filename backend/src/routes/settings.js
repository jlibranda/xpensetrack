// src/routes/settings.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const multer = require('multer');
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const NEW_DEFAULT_CATEGORIES = "Cleaning,Education and Training,Entertainment/Meals,Equipment,Facility Maintenance and Repair,Furniture and Fixtures,General Office Expense,Hardware,Miscellaneous,Mobile Device,Non-Capital Small Tools Equipment and Furniture,Office Rent,Parking,Printing,Recruiting,Travel - Air Ticket (International),Travel - Air Ticket (Domestic),Travel - Others,Travel - Hotel (Domestic)";
const OLD_DEFAULT_CATEGORIES = ['MEALS','TRAVEL','ACCOMMODATION','SUPPLIES','COMMUNICATIONS','OTHER'];

async function getOrCreate() {
  let s = await prisma.orgSettings.findFirst();
  if (!s) {
    s = await prisma.orgSettings.create({ data: { categories: "Cleaning,Education and Training,Entertainment/Meals,Equipment,Facility Maintenance and Repair,Furniture and Fixtures,General Office Expense,Hardware,Miscellaneous,Mobile Device,Non-Capital Small Tools Equipment and Furniture,Office Rent,Parking,Printing,Recruiting,Travel - Air Ticket (International),Travel - Air Ticket (Domestic),Travel - Others,Travel - Hotel (Domestic)" } });
  } else {
    // Always ensure new categories are set if they don't include our custom ones
    const hasCleaning = s.categories.includes('Cleaning');
    const hasEntertainment = s.categories.includes('Entertainment');
    if (!hasCleaning || !hasEntertainment) {
      s = await prisma.orgSettings.update({
        where: { id: s.id },
        data: { categories: "Cleaning,Education and Training,Entertainment/Meals,Equipment,Facility Maintenance and Repair,Furniture and Fixtures,General Office Expense,Hardware,Miscellaneous,Mobile Device,Non-Capital Small Tools Equipment and Furniture,Office Rent,Parking,Printing,Recruiting,Travel - Air Ticket (International),Travel - Air Ticket (Domestic),Travel - Others,Travel - Hotel (Domestic)" }
      });
    }
  }
  return s;
}

function parseSettings(s) {
  let glCodes = {};
  try { glCodes = JSON.parse(s.categoryGlCodes || '{}'); } catch(e) {}
  let accessControl = {};
  try { accessControl = JSON.parse(s.accessControlJson || '{}'); } catch(e) {}
  return {
    ...s,
    categories: s.categories.split(',').map(c => c.trim()).filter(Boolean),
    expenseTypes: s.expenseTypes.split(',').map(t => t.trim()).filter(Boolean),
    categoryGlCodes: glCodes,
    accessControl,
  };
}

router.get('/', authenticate, async (req, res) => {
  try { res.json(parseSettings(await getOrCreate())); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/', authenticate, requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { companyName, defaultCurrency, receiptRequiredAbove, approvalLevels,
            primaryColor, categories, expenseTypes, categoryGlCodes, defaultPassword, darkMode,
            wallpaperStyle, accessControl } = req.body;
    const s = await getOrCreate();
    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: {
        companyName, defaultCurrency,
        receiptRequiredAbove: receiptRequiredAbove ? Number(receiptRequiredAbove) : undefined,
        approvalLevels: approvalLevels ? Number(approvalLevels) : undefined,
        primaryColor, darkMode,
        wallpaperStyle: wallpaperStyle || undefined,
        categories: Array.isArray(categories) ? categories.join(',') : categories,
        expenseTypes: Array.isArray(expenseTypes) ? expenseTypes.join(',') : expenseTypes,
        categoryGlCodes: categoryGlCodes ? JSON.stringify(categoryGlCodes) : undefined,
        defaultPassword: defaultPassword || undefined,
        accessControlJson: accessControl !== undefined ? JSON.stringify(accessControl) : undefined,
      },
    });
    res.json(parseSettings(updated));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/logo', authenticate, requireRole('ADMIN'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { logoUrl: base64 } });
    res.json({ logoUrl: base64 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/wallpaper', authenticate, requireRole('ADMIN'), upload.single('wallpaper'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { wallpaperUrl: base64 } });
    res.json({ wallpaperUrl: base64 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/wallpaper', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const s = await getOrCreate();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { wallpaperUrl: null } });
    res.json({ message: 'Wallpaper removed' });
  } catch(err) { res.status(500).json({ error: err.message }); }
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
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


// POST /api/settings/reset-categories — force reset to new default categories
router.post('/reset-categories', authenticate, requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const s = await getOrCreate();
    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: { categories: "Cleaning,Education and Training,Entertainment/Meals,Equipment,Facility Maintenance and Repair,Furniture and Fixtures,General Office Expense,Hardware,Miscellaneous,Mobile Device,Non-Capital Small Tools Equipment and Furniture,Office Rent,Parking,Printing,Recruiting,Travel - Air Ticket (International),Travel - Air Ticket (Domestic),Travel - Others,Travel - Hotel (Domestic)" }
    });
    res.json({ message: 'Categories reset to defaults', categories: updated.categories.split(',') });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
