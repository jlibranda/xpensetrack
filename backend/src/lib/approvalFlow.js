// src/lib/approvalFlow.js
// Builds and re-applies an employee's approval chain.
//
// The chain is normally captured when an expense is submitted. These helpers
// let us re-apply an employee's CURRENT approvers/mode/rule to their already
// PENDING expenses — either on demand (admin button) or automatically when the
// org setting `autoReapplyApprovalFlow` is on.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Compute the ordered approver id list for a user: manager is #1, then the
// additional approverIds (#2..#5). De-duped, capped at 5, self excluded.
function approverIdsForUser(user) {
  const additional = (user.approverIds || '').split(',').map(s => s.trim()).filter(Boolean);
  let ids = [];
  if (user.managerId) ids.push(user.managerId);
  ids.push(...additional);
  ids = ids.filter(id => id && id !== user.id);
  return [...new Set(ids)].slice(0, 5);
}

// Build approval rows for an expense given the approver list + mode/rule.
function buildApprovalRows(expenseId, approverIds, rule) {
  if (rule === 'ANY') {
    const groupKey = `${expenseId}:any`;
    return approverIds.map((id) => ({ approverId: id, level: 1, stepOrder: 1, groupKey }));
  }
  return approverIds.map((id, idx) => ({ approverId: id, level: idx + 1, stepOrder: idx + 1, groupKey: null }));
}

// Re-apply the current approval flow to all PENDING expenses of one user.
// Preserves prior APPROVED decisions for approvers who remain in the new chain.
// Returns { updated, autoApproved } counts.
async function reapplyApprovalFlowForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { updated: 0, autoApproved: 0, error: 'User not found' };

  const pending = await prisma.expense.findMany({
    where: { submittedById: userId, status: 'PENDING' },
    include: { approvals: true },
  });
  if (pending.length === 0) return { updated: 0, autoApproved: 0 };

  const approverIds = approverIdsForUser(user);
  const rule = user.approvalRule || 'ALL';
  const mode = user.approvalMode || 'SEQUENTIAL';

  let updated = 0, autoApproved = 0;

  for (const exp of pending) {
    // If the employee now has NO approvers, auto-approve the pending expense.
    if (approverIds.length === 0) {
      await prisma.$transaction([
        prisma.approval.deleteMany({ where: { expenseId: exp.id } }),
        prisma.expense.update({ where: { id: exp.id }, data: { status: 'APPROVED' } }),
      ]);
      autoApproved++;
      continue;
    }

    // Preserve any prior APPROVED decision for approvers still in the new chain.
    const priorApproved = new Set(
      exp.approvals.filter(a => a.status === 'APPROVED').map(a => a.approverId)
    );

    const rows = buildApprovalRows(exp.id, approverIds, rule).map(r => ({
      ...r,
      status: priorApproved.has(r.approverId) ? 'APPROVED' : 'PENDING',
    }));

    // Decide whether the rebuilt chain is already fully satisfied.
    let satisfied;
    if (rule === 'ANY') {
      satisfied = rows.some(r => r.status === 'APPROVED');
    } else {
      satisfied = rows.every(r => r.status === 'APPROVED');
    }

    await prisma.$transaction([
      prisma.approval.deleteMany({ where: { expenseId: exp.id } }),
      ...rows.map(r => prisma.approval.create({ data: {
        expenseId: exp.id,
        approverId: r.approverId,
        level: r.level,
        stepOrder: r.stepOrder,
        groupKey: r.groupKey,
        status: r.status,
      }})),
      prisma.expense.update({ where: { id: exp.id }, data: { status: satisfied ? 'APPROVED' : 'PENDING' } }),
    ]);

    if (satisfied) autoApproved++; else updated++;
  }

  return { updated, autoApproved, total: pending.length };
}

module.exports = { reapplyApprovalFlowForUser, approverIdsForUser, buildApprovalRows };
