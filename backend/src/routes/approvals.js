// src/routes/approvals.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../lib/email');
const prisma = new PrismaClient();

// GET /api/approvals/pending
router.get('/pending', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const approvals = await prisma.approval.findMany({
      where: { approverId: req.user.id, status: 'PENDING' },
      include: {
        expense: {
          include: {
            submittedBy: { select: { id: true, name: true, email: true, department: true } },
            approvals: { include: { approver: { select: { name: true } } } },
            receipt: { select: { id: true, mimeType: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(approvals);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/approvals/history — all actioned approvals
router.get('/history', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const approvals = await prisma.approval.findMany({
      where: { approverId: req.user.id, status: { not: 'PENDING' } },
      include: {
        expense: { include: { submittedBy: { select: { id: true, name: true } }, receipt: { select: { id: true, mimeType: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    res.json(approvals);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/approvals/:id/approve
router.post('/:id/approve', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true, receipt: { select: { id: true, mimeType: true } } } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id) return res.status(403).json({ error: 'Not your approval' });
    if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already actioned' });

    const settings = await prisma.orgSettings.findFirst();
    const approvalLevels = settings?.approvalLevels || 2;

    await prisma.approval.update({ where: { id: approval.id }, data: { status: 'APPROVED', notes } });

    let finalStatus = 'APPROVED';
    if (approval.level === 1 && approvalLevels >= 2) {
      const finance = await prisma.user.findFirst({ where: { role: { in: ['FINANCE', 'ADMIN'] }, id: { not: req.user.id } } });
      if (finance) {
        await prisma.approval.create({ data: { expenseId: approval.expenseId, approverId: finance.id, level: 2, status: 'PENDING' } });
        finalStatus = 'PENDING';
      }
    }

    await prisma.expense.update({ where: { id: approval.expenseId }, data: { status: finalStatus } });
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, approval.expense.submittedBy.name, approval.expense,
      finalStatus === 'PENDING' ? 'MANAGER_APPROVED' : 'APPROVED').catch(() => {});

    res.json({ message: 'Approved', finalStatus });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/approvals/:id/reject
router.post('/:id/reject', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true, receipt: { select: { id: true, mimeType: true } } } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id) return res.status(403).json({ error: 'Not your approval' });
    if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already actioned' });

    await Promise.all([
      prisma.approval.update({ where: { id: approval.id }, data: { status: 'REJECTED', notes } }),
      prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'REJECTED' } }),
    ]);
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, approval.expense.submittedBy.name, approval.expense, 'REJECTED').catch(() => {});
    res.json({ message: 'Rejected' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/approvals/:id/return — return to submitter with comment
router.post('/:id/return', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'A comment is required when returning an expense' });
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true, receipt: { select: { id: true, mimeType: true } } } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id) return res.status(403).json({ error: 'Not your approval' });

    await Promise.all([
      prisma.approval.update({ where: { id: approval.id }, data: { status: 'REJECTED', notes: `[RETURNED FOR REVISION] ${notes}` } }),
      prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'REJECTED' } }),
    ]);

    // Notify submitter
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, approval.expense.submittedBy.name, approval.expense, 'RETURNED').catch(() => {});
    res.json({ message: 'Returned to submitter with comment' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/approvals/:id/reimburse — mark as reimbursed
router.post('/:id/reimburse', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.status !== 'APPROVED') return res.status(400).json({ error: 'Expense must be approved first' });
    await prisma.expense.update({ where: { id: req.params.id }, data: { status: 'REIMBURSED' } });
    res.json({ message: 'Marked as reimbursed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
