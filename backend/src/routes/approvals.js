// src/routes/approvals.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../lib/email');
const prisma = new PrismaClient();

// GET /api/approvals/pending — get pending approvals for this approver
router.get('/pending', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  const approvals = await prisma.approval.findMany({
    where: { approverId: req.user.id, status: 'PENDING' },
    include: {
      expense: {
        include: { submittedBy: { select: { id: true, name: true, email: true, department: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(approvals);
});

// POST /api/approvals/:id/approve
router.post('/:id/approve', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  const { notes } = req.body;
  const approval = await prisma.approval.findUnique({
    where: { id: req.params.id },
    include: { expense: { include: { submittedBy: true } } },
  });
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  if (approval.approverId !== req.user.id) return res.status(403).json({ error: 'Not your approval' });
  if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already actioned' });

  const settings = await prisma.orgSettings.findFirst();
  const approvalLevels = settings?.approvalLevels || 2;

  await prisma.approval.update({ where: { id: approval.id }, data: { status: 'APPROVED', notes } });

  let finalStatus = 'APPROVED';

  if (approval.level === 1 && approvalLevels >= 2) {
    // Create level-2 approval for finance
    const finance = await prisma.user.findFirst({ where: { role: 'FINANCE' } });
    if (finance) {
      await prisma.approval.create({
        data: { expenseId: approval.expenseId, approverId: finance.id, level: 2, status: 'PENDING' },
      });
      finalStatus = 'PENDING'; // still pending until finance approves
    }
  }

  await prisma.expense.update({ where: { id: approval.expenseId }, data: { status: finalStatus } });

  await sendStatusUpdateEmail(
    approval.expense.submittedBy.email,
    approval.expense.submittedBy.name,
    approval.expense,
    finalStatus === 'PENDING' ? 'MANAGER_APPROVED' : 'APPROVED'
  );

  res.json({ message: 'Approved', finalStatus });
});

// POST /api/approvals/:id/reject
router.post('/:id/reject', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  const { notes } = req.body;
  const approval = await prisma.approval.findUnique({
    where: { id: req.params.id },
    include: { expense: { include: { submittedBy: true } } },
  });
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  if (approval.approverId !== req.user.id) return res.status(403).json({ error: 'Not your approval' });

  await Promise.all([
    prisma.approval.update({ where: { id: approval.id }, data: { status: 'REJECTED', notes } }),
    prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'REJECTED' } }),
  ]);

  await sendStatusUpdateEmail(
    approval.expense.submittedBy.email,
    approval.expense.submittedBy.name,
    approval.expense,
    'REJECTED'
  );

  res.json({ message: 'Rejected' });
});

module.exports = router;
