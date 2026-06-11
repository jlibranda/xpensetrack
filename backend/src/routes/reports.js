// src/routes/reports.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const prisma = new PrismaClient();

// GET /api/reports/summary?from=&to=&userId=
router.get('/summary', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  const { from, to, userId } = req.query;
  const where = { status: { in: ['APPROVED', 'REIMBURSED'] } };
  if (userId) where.submittedById = userId;
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { submittedBy: { select: { name: true, department: true } } },
  });

  const totalPhp = expenses.reduce((s, e) => s + e.amountPhp, 0);
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amountPhp;
    return acc;
  }, {});
  const byEmployee = expenses.reduce((acc, e) => {
    const key = e.submittedBy.name;
    acc[key] = (acc[key] || 0) + e.amountPhp;
    return acc;
  }, {});

  res.json({ totalPhp, count: expenses.length, byCategory, byEmployee });
});

// GET /api/reports/export?from=&to=&userId=  — returns Excel file
router.get('/export', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  const { from, to, userId } = req.query;
  const where = {};
  if (userId) where.submittedById = userId;
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { submittedBy: { select: { name: true, email: true, department: true } } },
    orderBy: { expenseDate: 'desc' },
  });

  const rows = expenses.map(e => ({
    Date: e.expenseDate.toISOString().split('T')[0],
    Employee: e.submittedBy.name,
    Department: e.submittedBy.department || '',
    Description: e.title,
    Category: e.category,
    Type: e.expenseType,
    Amount: e.amount,
    Currency: e.currency,
    'Amount (PHP)': e.amountPhp.toFixed(2),
    'Cost Center': e.costCenter || '',
    Status: e.status,
    Notes: e.description || '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 16 },
    { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Expenses');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
