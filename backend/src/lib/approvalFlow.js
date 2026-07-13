// src/lib/approvalFlow.js
// Builds and re-applies an employee's approval chain.
//
// The chain is normally captured when an expense is submitted. These helpers
// let us re-apply an employee's CURRENT approvers/mode/rule to their already
// PENDING expenses — either on demand (admin button) or automatically when the
// org setting `autoReapplyApprovalFlow` is on.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getFlowSteps, buildRowsFromSteps } = require('./approvalChain');
const { createNotification } = require('./notifications');
const { logAudit } = require('./audit');

// Re-apply the current approval flow to all PENDING expenses of one user.
// Preserves prior APPROVED decisions for approvers who remain in the new chain.
async function reapplyApprovalFlowForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { updated: 0, autoApproved: 0, error: 'User not found' };

  const pending = await prisma.expense.findMany({
    where: { submittedById: userId, status: 'PENDING' },
    include: { approvals: true },
  });
  if (pending.length === 0) return { updated: 0, autoApproved: 0 };

  const steps = getFlowSteps(user);
  let updated = 0, autoApproved = 0;

  for (const exp of pending) {
    // No approvers in the flow -> auto-approve.
    if (steps.length === 0) {
      await prisma.$transaction([
        prisma.approval.deleteMany({ where: { expenseId: exp.id } }),
        prisma.expense.update({ where: { id: exp.id }, data: { status: 'APPROVED' } }),
      ]);
      // Auto-approvals must be visible: tell the submitter, leave an audit trail.
      await createNotification(user.id, 'EXPENSE_APPROVED',
        'Expense auto-approved',
        `Your expense "${exp.title}" was approved automatically (no approver in your updated flow).`,
        '/expenses').catch(() => {});
      await Promise.resolve(logAudit(user, 'EXPENSE_AUTO_APPROVED', { targetType: 'EXPENSE', targetId: exp.id, details: `Auto-approved "${exp.title}" during approval-flow re-apply (empty flow)` })).catch(() => {});
      autoApproved++;
      continue;
    }

    // Preserve prior APPROVED decisions for approvers still in the new chain.
    const priorApproved = new Set(
      exp.approvals.filter(a => a.status === 'APPROVED').map(a => a.approverId)
    );

    const rows = buildRowsFromSteps(exp.id, steps).map(r => ({
      ...r,
      status: priorApproved.has(r.approverId) ? 'APPROVED' : 'PENDING',
    }));

    // Is the rebuilt chain already fully satisfied? Honor each step's rule.
    const byStep = {};
    for (const r of rows) {
      (byStep[r.stepOrder] = byStep[r.stepOrder] || { rule: r.stepRule, rows: [] }).rows.push(r);
    }
    const allSatisfied = Object.values(byStep).every(st =>
      (st.rule === 'ALL')
        ? st.rows.every(r => r.status === 'APPROVED')
        : st.rows.some(r => r.status === 'APPROVED')
    );

    await prisma.$transaction([
      prisma.approval.deleteMany({ where: { expenseId: exp.id } }),
      ...rows.map(r => prisma.approval.create({ data: {
        expenseId: exp.id,
        approverId: r.approverId,
        level: r.level,
        stepOrder: r.stepOrder,
        groupKey: r.groupKey,
        stepRule: r.stepRule,
        status: r.status,
      }})),
      prisma.expense.update({ where: { id: exp.id }, data: { status: allSatisfied ? 'APPROVED' : 'PENDING' } }),
    ]);

    if (allSatisfied) {
      await createNotification(user.id, 'EXPENSE_APPROVED',
        'Expense fully approved!',
        `"${exp.title}" became fully approved when your approval flow was updated.`,
        '/expenses').catch(() => {});
      await Promise.resolve(logAudit(user, 'EXPENSE_APPROVED', { targetType: 'EXPENSE', targetId: exp.id, details: `"${exp.title}" auto-satisfied during approval-flow re-apply` })).catch(() => {});
      autoApproved++;
    } else {
      updated++;
    }
  }

  return { updated, autoApproved, total: pending.length };
}

module.exports = { reapplyApprovalFlowForUser };
