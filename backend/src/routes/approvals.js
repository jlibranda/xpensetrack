// src/routes/approvals.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../lib/email');
const { createNotification } = require('../lib/notifications');
const prisma = new PrismaClient();

const expenseInclude = {
  submittedBy: { select: { id: true, firstName: true, lastName: true, email: true, department: true } },
  approvals: { include: { approver: { select: { firstName: true, lastName: true, role: true } } }, orderBy: { stepOrder: 'asc' } },
  receipt: { select: { id: true, mimeType: true } },
};

// ---- helpers -------------------------------------------------------------

async function loadApprovals(expenseId) {
  return prisma.approval.findMany({ where: { expenseId }, orderBy: { stepOrder: 'asc' } });
}

// A step is identified by its groupKey (or stepOrder when no groupKey).
function groupId(a) { return a.groupKey || `lvl:${a.stepOrder}`; }

// Group approval rows into steps and evaluate each step.
// OR-group semantics: a step is SATISFIED if any row is APPROVED;
// BLOCKED if every row is REJECTED.
function summarizeSteps(approvals) {
  const groups = {};
  for (const a of approvals) {
    const g = groupId(a);
    if (!groups[g]) groups[g] = { stepOrder: a.stepOrder, rows: [] };
    groups[g].rows.push(a);
  }
  const steps = Object.values(groups).map((grp) => ({
    stepOrder: grp.stepOrder,
    satisfied: grp.rows.some(r => r.status === 'APPROVED'),
    blocked: grp.rows.every(r => r.status === 'REJECTED'),
    rows: grp.rows,
  }));
  steps.sort((a, b) => a.stepOrder - b.stepOrder);
  return steps;
}

// ANY_ORDER: any pending row is actionable.
// SEQUENTIAL: only rows in the lowest not-yet-satisfied step.
function isActionable(approval, allApprovals, mode) {
  if (approval.status !== 'PENDING') return false;
  if (mode === 'ANY_ORDER') return true;
  const steps = summarizeSteps(allApprovals);
  const firstOpen = steps.find(s => !s.satisfied && !s.blocked);
  return !!firstOpen && firstOpen.stepOrder === approval.stepOrder;
}

async function chainModeForExpense(expense) {
  const submitter = await prisma.user.findUnique({ where: { id: expense.submittedById } });
  return submitter?.approvalMode || 'SEQUENTIAL';
}

// ---- routes --------------------------------------------------------------

router.get('/pending', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const baseWhere = req.user.role === 'ADMIN'
      ? { status: 'PENDING' }
      : { approverId: req.user.id, status: 'PENDING' };

    const approvals = await prisma.approval.findMany({
      where: baseWhere,
      include: { expense: { include: expenseInclude } },
      orderBy: { createdAt: 'desc' },
    });

    const visible = [];
    for (const ap of approvals) {
      const all = await loadApprovals(ap.expenseId);
      const steps = summarizeSteps(all);
      const thisStep = steps.find(s => s.stepOrder === ap.stepOrder);
      if (thisStep && (thisStep.satisfied || thisStep.blocked)) continue; // step already resolved
      if (req.user.role === 'ADMIN') { visible.push(ap); continue; }
      const mode = await chainModeForExpense(ap.expense);
      if (isActionable(ap, all, mode)) visible.push(ap);
    }
    res.json(visible);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN'
      ? { status: { not: 'PENDING' } }
      : { approverId: req.user.id, status: { not: 'PENDING' } };
    const approvals = await prisma.approval.findMany({
      where,
      include: { expense: { include: { submittedBy: { select: { id: true, firstName: true, lastName: true } }, receipt: { select: { id: true, mimeType: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    res.json(approvals);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/approve', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Not your approval' });
    if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already actioned' });

    const all = await loadApprovals(approval.expenseId);
    const mode = await chainModeForExpense(approval.expense);

    if (req.user.role !== 'ADMIN' && !isActionable(approval, all, mode)) {
      return res.status(400).json({ error: 'An earlier approval step is still pending.' });
    }

    // Approve this row; auto-resolve OR-group siblings (one approver satisfies the step).
    const g = groupId(approval);
    const siblingIds = all.filter(a => groupId(a) === g && a.id !== approval.id && a.status === 'PENDING').map(a => a.id);
    await prisma.$transaction([
      prisma.approval.update({ where: { id: approval.id }, data: { status: 'APPROVED', notes } }),
      ...(siblingIds.length
        ? [prisma.approval.updateMany({ where: { id: { in: siblingIds } }, data: { status: 'APPROVED', notes: '[auto] satisfied by another approver in this step' } })]
        : []),
    ]);

    const updated = await loadApprovals(approval.expenseId);
    const steps = summarizeSteps(updated);
    // Guard: an expense with zero approval steps must NOT be treated as approved
    // ([].every(...) is true in JS). Require at least one step.
    const allSatisfied = steps.length > 0 && steps.every(s => s.satisfied);

    if (allSatisfied) {
      await prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'APPROVED' } });
      await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, 'APPROVED').catch(() => {});
      await createNotification(approval.expense.submittedById, 'EXPENSE_APPROVED',
        'Expense fully approved!', `"${approval.expense.title}" has been fully approved`, '/expenses');
      return res.json({ message: 'Approved', finalStatus: 'APPROVED' });
    }

    await prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'PENDING' } });

    if (mode === 'SEQUENTIAL') {
      const nextStep = steps.find(s => !s.satisfied && !s.blocked);
      if (nextStep) {
        for (const r of nextStep.rows.filter(x => x.status === 'PENDING')) {
          await createNotification(r.approverId, 'APPROVAL_REQUEST', 'Expense needs your approval',
            `"${approval.expense.title}" has reached your approval step`, '/approvals');
        }
      }
    }
    await createNotification(approval.expense.submittedById, 'EXPENSE_PROGRESS',
      'Approval progress', `"${approval.expense.title}" was approved at one step and awaits the remaining approver(s)`, '/expenses');

    res.json({ message: 'Approved', finalStatus: 'PENDING' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/reject', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Not your approval' });
    if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Already actioned' });

    // Any single rejection sends the whole expense back to the employee.
    await prisma.$transaction([
      prisma.approval.update({ where: { id: approval.id }, data: { status: 'REJECTED', notes } }),
      prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'REJECTED' } }),
    ]);
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, 'REJECTED').catch(() => {});
    await createNotification(approval.expense.submittedById, 'EXPENSE_REJECTED',
      'Expense rejected', `"${approval.expense.title}" was rejected${notes ? `: ${notes}` : ''}. You can edit and resubmit it.`, '/expenses');
    res.json({ message: 'Rejected' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/return', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'Comment required when returning' });
    const approval = await prisma.approval.findUnique({
      where: { id: req.params.id },
      include: { expense: { include: { submittedBy: true } } },
    });
    if (!approval) return res.status(404).json({ error: 'Not found' });
    if (approval.approverId !== req.user.id && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Not your approval' });
    await prisma.$transaction([
      prisma.approval.update({ where: { id: approval.id }, data: { status: 'REJECTED', notes: `[RETURNED] ${notes}` } }),
      prisma.expense.update({ where: { id: approval.expenseId }, data: { status: 'REJECTED' } }),
    ]);
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, 'RETURNED').catch(() => {});
    await createNotification(approval.expense.submittedById, 'EXPENSE_RETURNED',
      'Expense returned for revision', `"${approval.expense.title}" was returned: ${notes}`, '/expenses');
    res.json({ message: 'Returned' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/reimburse', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { submittedBy: true } });
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.status !== 'APPROVED') return res.status(400).json({ error: 'Must be approved first' });
    await prisma.expense.update({ where: { id: req.params.id }, data: { status: 'REIMBURSED' } });
    await sendStatusUpdateEmail(expense.submittedBy.email, `${expense.submittedBy.firstName} ${expense.submittedBy.lastName}`, expense, 'REIMBURSED').catch(() => {});
    await createNotification(expense.submittedById, 'EXPENSE_REIMBURSED',
      '\u{1F4B0} Expense reimbursed!', `"${expense.title}" has been reimbursed`, '/expenses');
    res.json({ message: 'Reimbursed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
