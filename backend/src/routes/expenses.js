// src/routes/expenses.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendApprovalRequestEmail, sendStatusUpdateEmail } = require('../lib/email');
const prisma = new PrismaClient();

const PHP_USD_RATE = 56;
function toPhp(amount, currency) {
  return currency === 'USD' ? amount * PHP_USD_RATE : amount;
}

// GET /api/expenses
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, category, from, to, page = 1, limit = 20 } = req.query;
    const where = {};
    if (req.user.role === 'EMPLOYEE') {
      where.submittedById = req.user.id;
    } else if (req.user.role === 'MANAGER') {
      const reportIds = (await prisma.user.findMany({ where: { managerId: req.user.id }, select: { id: true } })).map(u => u.id);
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
        include: {
          submittedBy: { select: { id: true, name: true, email: true, department: true } },
          approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.expense.count({ where }),
    ]);
    res.json({ expenses, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/expenses/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        submittedBy: { select: { id: true, name: true, email: true, department: true } },
        approvals: {
          include: { approver: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    res.json(expense);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/expenses
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, amount, currency = 'PHP', category = 'OTHER',
            expenseType = 'REIMBURSEMENT', receiptUrl, costCenter, expenseDate } = req.body;
    if (!title || !amount || !expenseDate) {
      return res.status(400).json({ error: 'title, amount, and expenseDate are required' });
    }
    const amountPhp = toPhp(Number(amount), currency);
    const expense = await prisma.expense.create({
      data: {
        title, description, amount: Number(amount), currency,
        amountPhp, category, expenseType,
        receiptUrl: receiptUrl || null,
        costCenter: costCenter || null,
        expenseDate: new Date(expenseDate),
        submittedById: req.user.id,
        status: 'DRAFT',
      },
      include: { submittedBy: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json(expense);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/expenses/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.submittedById !== req.user.id && req.user.role === 'EMPLOYEE') {
      return res.status(403).json({ error: 'Cannot edit this expense' });
    }
    if (!['DRAFT', 'REJECTED', 'CANCELLED'].includes(expense.status)) {
      return res.status(400).json({ error: 'Can only edit draft, rejected, or cancelled expenses' });
    }
    const { title, description, amount, currency, category, expenseType, receiptUrl, costCenter, expenseDate } = req.body;
    const amountPhp = amount ? toPhp(Number(amount), currency || expense.currency) : expense.amountPhp;
    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        title, description,
        amount: amount ? Number(amount) : undefined,
        currency, category, expenseType,
        receiptUrl: receiptUrl !== undefined ? receiptUrl : undefined,
        costCenter, amountPhp,
        expenseDate: expenseDate ? new Date(expenseDate) : undefined,
      },
    });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/expenses/:id/submit
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { submittedBy: { include: { manager: true } } },
    });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.submittedById !== req.user.id) return res.status(403).json({ error: 'Not your expense' });
    if (!['DRAFT', 'REJECTED', 'CANCELLED'].includes(expense.status)) {
      return res.status(400).json({ error: 'Already submitted' });
    }
    const manager = expense.submittedBy.manager;
    // Find any admin/finance as fallback approver
    const fallbackApprover = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'FINANCE'] } }
    });
    const approverId = manager?.id || fallbackApprover?.id || req.user.id;

    await prisma.$transaction([
      prisma.expense.update({ where: { id: expense.id }, data: { status: 'PENDING' } }),
      prisma.approval.deleteMany({ where: { expenseId: expense.id } }),
      prisma.approval.create({ data: { expenseId: expense.id, approverId, level: 1, status: 'PENDING' } }),
    ]);

    if (manager || fallbackApprover) {
      const approver = manager || fallbackApprover;
      await sendApprovalRequestEmail(approver.email, approver.name, expense).catch(() => {});
    }
    const updated = await prisma.expense.findUnique({ where: { id: expense.id } });
    res.json({ message: 'Submitted for approval', expense: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/expenses/:id/cancel — submitter cancels their own expense
router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { submittedBy: true },
    });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.submittedById !== req.user.id) return res.status(403).json({ error: 'Not your expense' });
    if (!['DRAFT', 'PENDING'].includes(expense.status)) {
      return res.status(400).json({ error: 'Can only cancel draft or pending expenses' });
    }
    await prisma.$transaction([
      prisma.expense.update({ where: { id: expense.id }, data: { status: 'CANCELLED', description: reason ? `${expense.description || ''}\n[CANCELLED: ${reason}]` : expense.description } }),
      prisma.approval.updateMany({ where: { expenseId: expense.id, status: 'PENDING' }, data: { status: 'REJECTED', notes: reason || 'Cancelled by submitter' } }),
    ]);
    res.json({ message: 'Expense cancelled' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/expenses/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.submittedById !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Cannot delete this expense' });
    }
    if (!['DRAFT', 'CANCELLED', 'REJECTED'].includes(expense.status)) {
      return res.status(400).json({ error: 'Can only delete draft, cancelled, or rejected expenses' });
    }
    await prisma.approval.deleteMany({ where: { expenseId: expense.id } });
    await prisma.expense.delete({ where: { id: expense.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
