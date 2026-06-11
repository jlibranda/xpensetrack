// src/routes/settings.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res) => {
  let settings = await prisma.orgSettings.findFirst();
  if (!settings) {
    settings = await prisma.orgSettings.create({ data: {} });
  }
  res.json(settings);
});

router.patch('/', authenticate, requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  const { companyName, defaultCurrency, receiptRequiredAbove, approvalLevels } = req.body;
  let settings = await prisma.orgSettings.findFirst();
  if (!settings) {
    settings = await prisma.orgSettings.create({ data: {} });
  }
  const updated = await prisma.orgSettings.update({
    where: { id: settings.id },
    data: { companyName, defaultCurrency, receiptRequiredAbove, approvalLevels },
  });
  res.json(updated);
});

module.exports = router;
