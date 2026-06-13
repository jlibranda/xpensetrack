// src/lib/approvalChain.js
// The approval flow is a list of STEPS. Each step = { approvers: [userId...], rule: 'ANY'|'ALL' }.
//  - rule 'ANY'  => any one approver in the step satisfies it (OR)
//  - rule 'ALL'  => every approver in the step must approve (AND)
// approvalMode on the user controls ordering across steps:
//  - SEQUENTIAL => steps must complete in order (step 1, then 2, ...)
//  - ANY_ORDER  => all steps are open at once

// Resolve the ordered steps for a user. Prefer the structured approvalFlowJson;
// otherwise derive from the legacy manager + approverIds + approvalRule fields so
// existing employees keep working until an admin saves the new builder.
function getFlowSteps(user) {
  // New structured flow
  if (user.approvalFlowJson) {
    try {
      const parsed = JSON.parse(user.approvalFlowJson);
      if (Array.isArray(parsed)) {
        const steps = parsed
          .map(s => ({
            approvers: [...new Set((s.approvers || []).filter(Boolean))],
            rule: s.rule === 'ALL' ? 'ALL' : 'ANY',
          }))
          .filter(s => s.approvers.length > 0);
        if (steps.length) return steps;
      }
    } catch (e) { /* fall through to legacy */ }
  }

  // Legacy derivation: manager is step 1, then additional approvers.
  const additional = (user.approverIds || '').split(',').map(s => s.trim()).filter(Boolean);
  const ordered = [];
  if (user.managerId) ordered.push(user.managerId);
  ordered.push(...additional);
  const uniq = [...new Set(ordered.filter(id => id && id !== user.id))];
  if (uniq.length === 0) return [];

  if ((user.approvalRule || 'ALL') === 'ANY') {
    // legacy ANY: everyone in one OR step
    return [{ approvers: uniq, rule: 'ANY' }];
  }
  // legacy ALL: each approver is its own required step
  return uniq.map(id => ({ approvers: [id], rule: 'ALL' }));
}

// All approver ids across the flow (used for team-scope compatibility).
function flatApproverIds(user) {
  return [...new Set(getFlowSteps(user).flatMap(s => s.approvers))];
}

// Build Approval rows for an expense from the resolved steps.
// Each step gets its own stepOrder + a shared groupKey + the step's rule.
function buildRowsFromSteps(expenseId, steps) {
  const rows = [];
  steps.forEach((step, idx) => {
    const stepOrder = idx + 1;
    const groupKey = `${expenseId}:step:${stepOrder}`;
    for (const approverId of step.approvers) {
      rows.push({ approverId, level: stepOrder, stepOrder, groupKey, stepRule: step.rule });
    }
  });
  return rows;
}

module.exports = { getFlowSteps, flatApproverIds, buildRowsFromSteps };
