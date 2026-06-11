// src/routes/expenses.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendApprovalRequestEmail } = require('../lib/email');
const prisma = new PrismaClient();

const PHP_USD_RATE = 56; // Update this from an exchange rate API in production

function toPhp(amount, currency) {
  return currency === 'USD' ? amount * PHP_USD_RATE : amount;
}

// GET /api/expenses  — list expenses (own for employee, all for manager+)
router.get('/', authenticate, async (req, res) => {
  const { status, category, from, to, page = 1, limit = 20 } = req.query;
  const where = {};

  if (req.user.role === 'EMPLOYEE') {
    where.submittedById = req.user.id;
  } else if (req.user.role === 'MANAGER') {
    // managers see their own + their reports
    const reportIds = (await prisma.user.findMany({
      where: { managerId: req.user.id }, select: { id: true }
    })).map(u => u.id);
    where.submittedById = { in: [req.user.id, ...reportIds] };
  }

  if (status) where.status = status;
  if (category) where.category = category;
  if (from || to) {
    where.expenseDate = {};
    if (from) where.expenseDate.gte = new Date(from);
    if (to) where.expenseDate.lte = new Date(to);
  }

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: { submittedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
    prisma.expense.count({ where }),
  ]);

  res.json({ expenses, total, page: Number(page), pages: Math.ceil(total / limit) });
});

// GET /api/expenses/:id
router.get('/:id', authenticate, async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: {
      submittedBy: { select: { id: true, name: true, email: true, department: true } },
      approvals: { include: { approver: { select: { id: true, name: true, role: true } } } },
    },
  });
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  res.json(expense);
});

// POST /api/expenses
router.post('/', authenticate, async (req, res) => {
  const { title, description, amount, currency = 'PHP', category,
          expenseType = 'REIMBURSEMENT', receiptUrl, costCenter, expenseDate } = req.body;

  if (!title || !amount || !category || !expenseDate) {
    return res.status(400).json({ error: 'title, amount, category, and expenseDate are required' });
  }

  try {
    const amountPhp = toPhp(Number(amount), currency);
    const expense = await prisma.expense.create({
      data: {
        title, description, amount: Number(amount), currency,
        amountPhp, category, expenseType, receiptUrl, costCenter,
        expenseDate: new Date(expenseDate),
        submittedById: req.user.id,
        status: 'DRAFT',
      },
      include: { submittedBy: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/expenses/:id
router.patch('/:id', authenticate, async (req, res) => {
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });
  if (expense.submittedById !== req.user.id && req.user.role === 'EMPLOYEE') {
    return res.status(403).json({ error: 'Cannot edit this expense' });
  }
  if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
    return res.status(400).json({ error: 'Can only edit draft or rejected expenses' });
  }

  const { title, description, amount, currency, category, expenseType,
          receiptUrl, costCenter, expenseDate } = req.body;
  const amountPhp = amount ? toPhp(Number(amount), currency || expense.currency) : expense.amountPhp;

  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: { title, description, amount: amount ? Number(amount) : undefined,
            currency, category, expenseType, receiptUrl, costCenter,
            expenseDate: expenseDate ? new Date(expenseDate) : undefined, amountPhp },
  });
  res.json(updated);
});

// POST /api/expenses/:id/submit  — submit for approval
router.post('/:id/submit', authenticate, async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: { submittedBy: { include: { manager: true } } },
  });
  if (!expense) return res.status(404).json({ error: 'Not found' });
  if (expense.submittedById !== req.user.id) return res.status(403).json({ error: 'Not your expense' });
  if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
    return res.status(400).json({ error: 'Already submitted' });
  }

  const manager = expense.submittedBy.manager;

  const [updated] = await prisma.$transaction([
    prisma.expense.update({ where: { id: expense.id }, data: { status: 'PENDING' } }),
    prisma.approval.create({
      data: {
        expenseId: expense.id,
        approverId: manager ? manager.id : req.user.id,
        level: 1,
        status: 'PENDING',
      },
    }),
  ]);

  if (manager) {
    await sendApprovalRequestEmail(manager.email, manager.name, expense);
  }

  res.json({ message: 'Submitted for approval', expense: updated });
});

// DELETE /api/expenses/:id
router.delete('/:id', authenticate, async (req, res) => {
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });
  if (expense.submittedById !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cannot delete this expense' });
  }
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ message: 'Deleted' });
});

module.exports = router;
