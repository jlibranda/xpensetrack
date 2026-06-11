// src/routes/settings.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const multer = require('multer');
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function getOrCreateSettings() {
  let s = await prisma.orgSettings.findFirst();
  if (!s) s = await prisma.orgSettings.create({ data: {} });
  return s;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const s = await getOrCreateSettings();
    res.json({
      ...s,
      categories: s.categories.split(',').map(c => c.trim()).filter(Boolean),
      expenseTypes: s.expenseTypes.split(',').map(t => t.trim()).filter(Boolean),
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/', authenticate, requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { companyName, defaultCurrency, receiptRequiredAbove, approvalLevels,
            primaryColor, categories, expenseTypes } = req.body;
    const s = await getOrCreateSettings();
    const updated = await prisma.orgSettings.update({
      where: { id: s.id },
      data: {
        companyName, defaultCurrency,
        receiptRequiredAbove: receiptRequiredAbove ? Number(receiptRequiredAbove) : undefined,
        approvalLevels: approvalLevels ? Number(approvalLevels) : undefined,
        primaryColor,
        categories: Array.isArray(categories) ? categories.join(',') : categories,
        expenseTypes: Array.isArray(expenseTypes) ? expenseTypes.join(',') : expenseTypes,
      },
    });
    res.json({
      ...updated,
      categories: updated.categories.split(',').map(c => c.trim()).filter(Boolean),
      expenseTypes: updated.expenseTypes.split(',').map(t => t.trim()).filter(Boolean),
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/logo — upload logo
router.post('/logo', authenticate, requireRole('ADMIN'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const s = await getOrCreateSettings();
    await prisma.orgSettings.update({ where: { id: s.id }, data: { logoUrl: base64 } });
    res.json({ logoUrl: base64 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
