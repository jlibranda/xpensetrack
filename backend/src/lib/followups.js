// Automatic approval follow-up reminders.
// Periodically emails the CURRENT pending approver(s) of expenses that have been
// waiting too long. The threshold (in days) is configured in OrgSettings.approvalFollowUpDays
// (0 = disabled). Honors AND/OR step rules and SEQUENTIAL vs ANY_ORDER flow.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function groupId(a) { return a.groupKey || `lvl:${a.stepOrder}`; }

// Mirror of approvals.js summarizeSteps.
function summarizeSteps(approvals) {
  const groups = {};
  for (const a of approvals) {
    const g = groupId(a);
    if (!groups[g]) groups[g] = { stepOrder: a.stepOrder, rule: a.stepRule || 'ANY', rows: [] };
    groups[g].rows.push(a);
  }
  const steps = Object.values(groups).map((grp) => {
    const rule = grp.rule || 'ANY';
    const satisfied = rule === 'ALL' ? grp.rows.every(r => r.status === 'APPROVED') : grp.rows.some(r => r.status === 'APPROVED');
    const blocked = rule === 'ALL' ? grp.rows.some(r => r.status === 'REJECTED') : grp.rows.every(r => r.status === 'REJECTED');
    return { stepOrder: grp.stepOrder, rule, satisfied, blocked, rows: grp.rows };
  });
  steps.sort((a, b) => a.stepOrder - b.stepOrder);
  return steps;
}

async function runFollowups() {
  let settings;
  try { settings = await prisma.orgSettings.findFirst(); } catch (e) { return; }
  const days = settings?.approvalFollowUpDays || 0;
  if (!days || days <= 0) return; // disabled
  if (settings?.emailNotificationsEnabled === false) return; // notifications off (testing)

  const thresholdMs = days * DAY_MS;
  const now = Date.now();

  let expenses;
  try {
    expenses = await prisma.expense.findMany({
      where: { status: 'PENDING' },
      include: {
        submittedBy: true,
        approvals: { include: { approver: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
    });
  } catch (e) { console.error('Follow-ups: load failed:', e.message); return; }

  const { sendApprovalReminderEmail } = require('./email');

  for (const exp of expenses) {
    try {
      const approvals = [...(exp.approvals || [])].sort((a, b) => a.stepOrder - b.stepOrder);
      if (approvals.length === 0) continue;
      const steps = summarizeSteps(approvals);
      const mode = exp.submittedBy?.approvalMode || 'SEQUENTIAL';

      // Which approval rows are "currently pending" and need nudging?
      let pendingRows = [];
      let activeSince = new Date(exp.createdAt).getTime();
      if (mode === 'ANY_ORDER') {
        pendingRows = approvals.filter(a => a.status === 'PENDING');
        activeSince = new Date(exp.createdAt).getTime();
      } else {
        const activeStep = steps.find(s => !s.satisfied && !s.blocked);
        if (!activeStep) continue;
        pendingRows = activeStep.rows.filter(r => r.status === 'PENDING');
        // The step became active when the previous step was approved.
        const priorApproved = approvals.filter(a => a.status === 'APPROVED' && a.stepOrder < activeStep.stepOrder);
        const priorMax = priorApproved.reduce((m, a) => Math.max(m, new Date(a.updatedAt).getTime()), 0);
        activeSince = Math.max(new Date(exp.createdAt).getTime(), priorMax);
      }
      if (pendingRows.length === 0) continue;
      if (now - activeSince < thresholdMs) continue; // not waiting long enough yet

      const daysWaiting = Math.floor((now - activeSince) / DAY_MS);

      for (const r of pendingRows) {
        // Don't re-nudge more often than every `days` days.
        if (r.lastFollowUpAt && (now - new Date(r.lastFollowUpAt).getTime()) < thresholdMs) continue;
        const ap = r.approver;
        if (!ap?.email) continue;
        await sendApprovalReminderEmail(ap.email, `${ap.firstName || ''} ${ap.lastName || ''}`.trim(), exp, exp.submittedBy, daysWaiting).catch(() => {});
        await prisma.approval.update({ where: { id: r.id }, data: { lastFollowUpAt: new Date() } }).catch(() => {});
      }
    } catch (e) { console.error('Follow-ups: expense', exp.id, 'failed:', e.message); }
  }

  // ---- AP/AR (LedgerDoc) pending approvals — same nudging logic as expenses ----
  let ledgers = [];
  try {
    ledgers = await prisma.ledgerDoc.findMany({
      where: { status: 'PENDING' },
      include: {
        createdBy: true,
        approvals: { include: { approver: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
    });
  } catch (e) { console.error('Follow-ups: ledger load failed:', e.message); ledgers = []; }

  for (const doc of ledgers) {
    try {
      const approvals = [...(doc.approvals || [])].sort((a, b) => a.stepOrder - b.stepOrder);
      if (approvals.length === 0) continue;
      const steps = summarizeSteps(approvals);
      const mode = doc.createdBy?.approvalMode || 'SEQUENTIAL';
      let pendingRows = [];
      let activeSince = new Date(doc.createdAt).getTime();
      if (mode === 'ANY_ORDER') {
        pendingRows = approvals.filter(a => a.status === 'PENDING');
      } else {
        const activeStep = steps.find(s => !s.satisfied && !s.blocked);
        if (!activeStep) continue;
        pendingRows = activeStep.rows.filter(r => r.status === 'PENDING');
        const priorApproved = approvals.filter(a => a.status === 'APPROVED' && a.stepOrder < activeStep.stepOrder);
        const priorMax = priorApproved.reduce((m, a) => Math.max(m, new Date(a.updatedAt).getTime()), 0);
        activeSince = Math.max(new Date(doc.createdAt).getTime(), priorMax);
      }
      if (pendingRows.length === 0) continue;
      if (now - activeSince < thresholdMs) continue;
      const daysWaiting = Math.floor((now - activeSince) / DAY_MS);
      const emailExpense = {
        title: `${doc.vendorName || 'AP/AR document'}${doc.docNumber ? ` \u2014 ${doc.docNumber}` : ''}`,
        amount: doc.amount != null ? doc.amount : (doc.amountPhp || 0),
        currency: doc.currency || 'PHP',
        submittedBy: doc.createdBy || null,
        submittedById: doc.createdById || null,
      };
      for (const r of pendingRows) {
        if (r.lastFollowUpAt && (now - new Date(r.lastFollowUpAt).getTime()) < thresholdMs) continue;
        const ap = r.approver;
        if (!ap?.email) continue;
        await sendApprovalReminderEmail(ap.email, `${ap.firstName || ''} ${ap.lastName || ''}`.trim(), emailExpense, doc.createdBy, daysWaiting).catch(() => {});
        await prisma.approval.update({ where: { id: r.id }, data: { lastFollowUpAt: new Date() } }).catch(() => {});
      }
    } catch (e) { console.error('Follow-ups: ledger', doc.id, 'failed:', e.message); }
  }
}

let timer = null;
function startApprovalFollowups() {
  if (timer) return;
  const { runIfDue } = require('./scheduler-lock');
  const INTERVAL = 6 * 60 * 60 * 1000; // real cadence: every 6h (enforced across replicas)
  const CHECK = 30 * 60 * 1000;        // each replica checks every 30 min
  setTimeout(() => { runIfDue('approval_followups', INTERVAL, runFollowups); }, 30 * 1000);
  timer = setInterval(() => { runIfDue('approval_followups', INTERVAL, runFollowups); }, CHECK);
  console.log('Approval follow-up scheduler started (single-runner, ~6h).');
}

module.exports = { startApprovalFollowups, runFollowups };
