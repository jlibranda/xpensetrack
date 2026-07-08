// src/routes/expenses.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendApprovalRequestEmail } = require('../lib/email');
const { createNotification } = require('../lib/notifications');
const { logAudit } = require('../lib/audit');
const { getUsdPhpRate } = require('../lib/fxrate');
const { getFlowSteps, buildRowsFromSteps } = require('../lib/approvalChain');
const prisma = new PrismaClient();

// Convert an amount to PHP using the org's current USD->PHP rate.
const toPhp = async (amt, cur) => {
  if (cur !== 'USD') return amt;
  const rate = await getUsdPhpRate();
  return amt * rate;
};

const expenseInclude = {
  submittedBy: { select: { id:true, firstName:true, lastName:true, email:true, department:true, costCenter:true } },
  approvals: {
    include: { approver: { select: { id:true, firstName:true, lastName:true, role:true, email:true } } },
    orderBy: { createdAt: 'asc' },
  },
  receipt: { select: { id:true, mimeType:true, filename:true } },
  proofOfPayment: { select: { id:true, mimeType:true, filename:true } },
};

// People who report to / are approved by this user (excludes the user themselves) —
// mirrors the reports summary "team" definition so the dashboard stays consistent.
async function teamMemberIds(userId) {
  const everyone = await prisma.user.findMany({ select: { id: true, managerId: true, approverIds: true, approvalFlowJson: true } });
  const ids = new Set();
  for (const u of everyone) {
    if (u.id === userId) continue;
    if (u.managerId === userId) { ids.add(u.id); continue; }
    const additional = (u.approverIds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (additional.includes(userId)) { ids.add(u.id); continue; }
    if (u.approvalFlowJson) {
      try {
        const steps = JSON.parse(u.approvalFlowJson);
        if (Array.isArray(steps) && steps.some(s => (s.approvers || []).includes(userId))) ids.add(u.id);
      } catch (e) { /* ignore */ }
    }
  }
  return [...ids];
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, category, from, to, page=1, limit=20, scope } = req.query;
    const where = {};
    const role = req.user.role;
    if (scope) {
      // Dashboard scope toggle: self | team | all (all is Finance/Admin only).
      let requested = scope;
      if (requested === 'all' && !['FINANCE','ADMIN'].includes(role)) requested = 'team';
      if (requested === 'self') {
        where.submittedById = req.user.id;
      } else if (requested === 'team') {
        const team = await teamMemberIds(req.user.id);
        where.submittedById = { in: team.length ? team : ['__none__'] };
      } // 'all' -> no submittedById filter
    } else if (role === 'EMPLOYEE') {
      where.submittedById = req.user.id;
    } else if (role === 'MANAGER') {
      const ids = (await prisma.user.findMany({ where:{managerId:req.user.id}, select:{id:true} })).map(u=>u.id);
      where.submittedById = { in: [req.user.id, ...ids] };
    }
    if (status) where.status = status;
    if (category) where.category = category;
    if (from||to) { where.expenseDate={}; if(from) where.expenseDate.gte=new Date(from); if(to) where.expenseDate.lte=new Date(to+'T23:59:59'); }
    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({ where, include: expenseInclude, orderBy:{createdAt:'desc'}, skip:(page-1)*Number(limit), take:Number(limit) }),
      prisma.expense.count({ where }),
    ]);
    res.json({ expenses, total, page:Number(page), pages:Math.ceil(total/Number(limit)) });
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.get('/pending-count', authenticate, async (req, res) => {
  try {
    const myPending = await prisma.expense.count({ where: { submittedById: req.user.id, status: 'PENDING' } });
    // Returned expenses need the employee's attention (edit & resubmit).
    const myReturned = await prisma.expense.count({ where: { submittedById: req.user.id, status: 'RETURNED' } });

    let toApprove = 0;
    if (['MANAGER','FINANCE','ADMIN'].includes(req.user.role)) {
      if (req.user.role === 'ADMIN') {
        // Admin can act on any pending approval; count distinct expenses with a pending row.
        const rows = await prisma.approval.findMany({
          where: { status: 'PENDING', expenseId: { not: null } },
          select: { expenseId: true },
          distinct: ['expenseId'],
        });
        toApprove = rows.length;
      } else {
        // For non-admins, count only approvals that are ACTUALLY actionable now.
        // A pending row is actionable if its step is the first unsatisfied step
        // (sequential) or always (any-order), and its step isn't already satisfied
        // by an OR-group sibling.
        const myRows = await prisma.approval.findMany({
          where: { approverId: req.user.id, status: 'PENDING', expenseId: { not: null } },
          select: { id: true, expenseId: true, stepOrder: true, groupKey: true },
        });
        const expenseIds = [...new Set(myRows.map(r => r.expenseId))];
        const actionableExpenses = new Set();

        for (const exId of expenseIds) {
          const all = await prisma.approval.findMany({ where: { expenseId: exId } });
          // group into steps
          const groups = {};
          for (const a of all) {
            const g = a.groupKey || `lvl:${a.stepOrder}`;
            if (!groups[g]) groups[g] = { stepOrder: a.stepOrder, rows: [] };
            groups[g].rows.push(a);
          }
          const steps = Object.values(groups).map(grp => ({
            stepOrder: grp.stepOrder,
            satisfied: grp.rows.some(r => r.status === 'APPROVED'),
            blocked: grp.rows.every(r => r.status === 'REJECTED'),
            rows: grp.rows,
          })).sort((a,b)=>a.stepOrder-b.stepOrder);

          // submitter's chain mode
          const ex = await prisma.expense.findUnique({ where: { id: exId }, select: { submittedBy: { select: { approvalMode: true } } } });
          const mode = ex?.submittedBy?.approvalMode || 'SEQUENTIAL';
          const firstOpen = steps.find(s => !s.satisfied && !s.blocked);

          // is any of my pending rows in this expense actionable?
          const mine = myRows.filter(r => r.expenseId === exId);
          for (const r of mine) {
            const myStep = steps.find(s => s.stepOrder === r.stepOrder);
            if (!myStep || myStep.satisfied || myStep.blocked) continue;
            if (mode === 'ANY_ORDER' || (firstOpen && firstOpen.stepOrder === r.stepOrder)) {
              actionableExpenses.add(exId);
              break;
            }
          }
        }
        toApprove = actionableExpenses.size;
      }
    }

    res.json({ myPending, myReturned, toApprove });
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const e = await prisma.expense.findUnique({ where:{id:req.params.id}, include:expenseInclude });
    if(!e) return res.status(404).json({error:'Not found'});
    const u = req.user;
    const isOwner = e.submittedById === u.id;
    const isPriv = ['ADMIN','FINANCE'].includes(u.role);
    const isApprover = (e.approvals || []).some(a => a.approverId === u.id);
    let isMgr = false;
    if (!isOwner && !isPriv && !isApprover && u.role === 'MANAGER') {
      const team = await teamMemberIds(u.id);
      isMgr = team.includes(e.submittedById);
    }
    if (!(isOwner || isPriv || isApprover || isMgr)) return res.status(403).json({ error: 'Forbidden' });
    res.json(e);
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, amount, currency='PHP', category='OTHER',
            expenseType='REIMBURSEMENT', receiptId, costCenter, expenseDate,
            merchant, orNumber } = req.body;
    if(!title||!amount||!expenseDate) return res.status(400).json({error:'title, amount, expenseDate required'});
    const amountPhp = await toPhp(Number(amount), currency);
    const expense = await prisma.expense.create({
      data: {
        title, description: description||null,
        merchant: merchant || null,
        orNumber: orNumber || null,
        amount: Number(amount), currency,
        amountPhp,
        category, expenseType,
        receiptId: receiptId || null,
        costCenter: costCenter || req.user.costCenter || null,
        expenseDate: new Date(expenseDate),
        submittedById: req.user.id,
        status: 'DRAFT',
      },
      include: expenseInclude,
    });
    res.status(201).json(expense);
  } catch(err){ res.status(500).json({error:err.message}); }
});

// Check for potential duplicate expenses for the current user.
// Matches on same amount + same date, and (same OR number OR same merchant).
// Returns a list of possible duplicates (non-blocking warning for the UI).
router.post('/check-duplicate', authenticate, async (req, res) => {
  try {
    const { amount, expenseDate, orNumber, merchant, excludeId } = req.body;
    if (!amount || !expenseDate) return res.json({ duplicates: [] });

    // Use a wide ±1 day window to be timezone-safe, then filter to the exact
    // calendar day by comparing date strings.
    const day = new Date(expenseDate);
    const wideStart = new Date(day); wideStart.setDate(wideStart.getDate() - 1);
    const wideEnd = new Date(day); wideEnd.setDate(wideEnd.getDate() + 1);
    const targetDay = String(expenseDate).slice(0, 10);

    // Core match: same user, same amount, not cancelled, within the wide window.
    const where = {
      submittedById: req.user.id,
      amount: Number(amount),
      expenseDate: { gte: wideStart, lte: wideEnd },
      status: { not: 'CANCELLED' },
    };
    if (excludeId) where.id = { not: excludeId };

    let candidates = await prisma.expense.findMany({
      where,
      select: { id: true, title: true, merchant: true, orNumber: true, amount: true, currency: true, expenseDate: true, status: true },
      take: 20,
    });

    // Keep only those whose expense date matches the exact target calendar day.
    candidates = candidates.filter(c => new Date(c.expenseDate).toISOString().slice(0, 10) === targetDay);

    // If a merchant or OR number was given, prefer rows that also share one of them;
    // but if none share it, still treat the amount+date matches as possible duplicates.
    const m = (merchant || '').trim().toLowerCase();
    const orn = (orNumber || '').trim().toLowerCase();
    if (m || orn) {
      const strong = candidates.filter(c =>
        (m && (c.merchant || '').trim().toLowerCase() === m) ||
        (orn && (c.orNumber || '').trim().toLowerCase() === orn)
      );
      if (strong.length) candidates = strong;
    }

    res.json({ duplicates: candidates.slice(0, 5) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, async (req, res) => {
  try {
    const e = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
    if(!e) return res.status(404).json({error:'Not found'});
    // Once approved by ANY approver (or fully approved / processed), the form is
    // locked. Only FINANCE and ADMIN may edit it after that point.
    const isAdminFinance = ['ADMIN', 'FINANCE'].includes(req.user.role);
    const approvedByAny = ['APPROVED', 'PROCESSED'].includes(e.status) || (e.approvals || []).some(a => a.status === 'APPROVED');
    if (approvedByAny) {
      if (!isAdminFinance) return res.status(403).json({ error: 'This expense is locked after approval — only Finance or Admin can edit it.' });
    } else {
      if(e.submittedById!==req.user.id && req.user.role==='EMPLOYEE') return res.status(403).json({error:'Forbidden'});
      if(!['DRAFT','RETURNED','CANCELLED'].includes(e.status)) return res.status(400).json({error:'Cannot edit in current status'});
    }
    const { title, orNumber, merchant, description, amount, currency, category, expenseType, receiptId, costCenter, expenseDate } = req.body;
    const amountPhp = amount ? await toPhp(Number(amount), currency||e.currency) : undefined;
    const updated = await prisma.expense.update({
      where:{id:req.params.id},
      data:{
        title: title||(merchant?merchant:undefined), orNumber: orNumber!==undefined?orNumber||null:undefined, merchant: merchant!==undefined?merchant||null:undefined, description,
        amount: amount ? Number(amount) : undefined,
        currency, category, expenseType,
        receiptId: receiptId !== undefined ? (receiptId||null) : undefined,
        costCenter, amountPhp,
        expenseDate: expenseDate ? new Date(expenseDate) : undefined,
        // A pre-approval edit resets to DRAFT (must be re-submitted). An admin/finance
        // correction to an already-approved expense keeps its current status.
        status: approvedByAny ? undefined : 'DRAFT',
      },
      include: expenseInclude,
    });
    res.json(updated);
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const expense = await prisma.expense.findUnique({
      where:{id:req.params.id},
      include:{ submittedBy:{ include:{ manager:true } } },
    });
    if(!expense) return res.status(404).json({error:'Not found'});
    if(expense.submittedById!==req.user.id) return res.status(403).json({error:'Forbidden'});
    if(!['DRAFT','RETURNED','CANCELLED'].includes(expense.status)) return res.status(400).json({error:'Already submitted'});

    const submitter = expense.submittedBy;

    // Resolve the employee's approval flow as STEPS (each step has its own
    // approvers + ANY/ALL rule). Falls back to legacy fields if no step flow set.
    const steps = getFlowSteps(submitter);

    // No approvers in the flow -> auto-approve on submission.
    if (steps.length === 0) {
      await prisma.$transaction([
        prisma.expense.update({ where: { id: expense.id }, data: { status: 'APPROVED' } }),
        prisma.approval.deleteMany({ where: { expenseId: expense.id } }),
      ]);
      await createNotification(req.user.id, 'EXPENSE_APPROVED',
        'Expense auto-approved',
        `Your expense "${expense.title}" was approved automatically (no approver assigned).`,
        '/expenses'
      );
      return res.json({ message: 'Submitted', expense: await prisma.expense.findUnique({ where: { id: expense.id } }) });
    }

    const mode = submitter.approvalMode || 'SEQUENTIAL'; // ordering across steps
    const approvalRows = buildRowsFromSteps(expense.id, steps);

    await prisma.$transaction([
      prisma.expense.update({where:{id:expense.id}, data:{status:'PENDING'}}),
      prisma.approval.deleteMany({where:{expenseId:expense.id}}),
      ...approvalRows.map((r) => prisma.approval.create({ data: {
        expenseId: expense.id,
        approverId: r.approverId,
        level: r.stepOrder,
        stepOrder: r.stepOrder,
        groupKey: r.groupKey,
        stepRule: r.stepRule,
        status: 'PENDING',
      }})),
    ]);

    // Who is actionable right now?
    //  - ANY_ORDER: everyone in every step at once.
    //  - SEQUENTIAL: only step 1.
    let notifyRows;
    if (mode === 'ANY_ORDER') notifyRows = approvalRows;
    else notifyRows = approvalRows.filter(r => r.stepOrder === 1);

    const notifiedIds = [...new Set(notifyRows.map(r => r.approverId))];
    for (const approverId of notifiedIds) {
      const approver = await prisma.user.findUnique({ where: { id: approverId } });
      if (approver) {
        await sendApprovalRequestEmail(approver.email, `${approver.firstName||''} ${approver.lastName||''}`.trim(), expense, submitter).catch(()=>{});
        await createNotification(approverId, 'APPROVAL_REQUEST',
          'New expense to approve',
          `${submitter.firstName} ${submitter.lastName} submitted "${expense.title}" for approval`,
          '/approvals'
        );
      }
    }
    await createNotification(req.user.id, 'EXPENSE_SUBMITTED',
      'Expense submitted',
      `Your expense "${expense.title}" has been submitted for approval`,
      '/expenses'
    );

    res.json({message:'Submitted', expense: await prisma.expense.findUnique({where:{id:expense.id}})});
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const e = await prisma.expense.findUnique({where:{id:req.params.id}});
    if(!e) return res.status(404).json({error:'Not found'});
    if(e.submittedById!==req.user.id) return res.status(403).json({error:'Forbidden'});
    if(!['DRAFT','PENDING'].includes(e.status)) return res.status(400).json({error:'Cannot cancel'});
    await prisma.$transaction([
      prisma.expense.update({where:{id:e.id}, data:{status:'CANCELLED', description: reason ? `${e.description||''}\n[Cancelled: ${reason}]`.trim() : e.description}}),
      prisma.approval.updateMany({where:{expenseId:e.id,status:'PENDING'}, data:{status:'REJECTED',notes:reason||'Cancelled by submitter'}}),
    ]);
    res.json({message:'Cancelled'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const e = await prisma.expense.findUnique({where:{id:req.params.id}});
    if(!e) return res.status(404).json({error:'Not found'});
    if(e.submittedById!==req.user.id && req.user.role!=='ADMIN') return res.status(403).json({error:'Forbidden'});
    if(!['DRAFT','CANCELLED','RETURNED'].includes(e.status)) return res.status(400).json({error:'Cannot delete'});
    await prisma.approval.deleteMany({where:{expenseId:e.id}});
    await prisma.expense.delete({where:{id:e.id}});
    res.json({message:'Deleted'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// ADMIN: permanently delete ALL expenses within a date range (by expenseDate).
// Optional status filter; if omitted, deletes every status in range.
// ADMIN: delete specific transactions by id (from checkbox selection).
router.post('/delete-selected', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No transactions selected.' });
    }
    await prisma.approval.deleteMany({ where: { expenseId: { in: ids } } });
    const result = await prisma.expense.deleteMany({ where: { id: { in: ids } } });
    await logAudit(req.user, 'TRANSACTION_BULK_DELETED', { targetType: 'TRANSACTION', details: `Deleted ${result.count} selected transaction(s)` });
    res.json({ deleted: result.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-delete', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to, status } = req.body;
    const where = {};
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(from);
      if (to) where.expenseDate.lte = new Date(to + 'T23:59:59');
    }
    if (status) where.status = status;

    // Must have at least a date bound to avoid accidental "delete everything".
    if (!from && !to) {
      return res.status(400).json({ error: 'Please provide a date range (from / to) before deleting.' });
    }

    const targets = await prisma.expense.findMany({ where, select: { id: true } });
    const ids = targets.map(t => t.id);
    if (ids.length === 0) return res.json({ deleted: 0 });

    // Remove dependent approvals first, then the expenses (permanent).
    await prisma.approval.deleteMany({ where: { expenseId: { in: ids } } });
    const result = await prisma.expense.deleteMany({ where: { id: { in: ids } } });
    await logAudit(req.user, 'TRANSACTION_BULK_DELETED', { targetType: 'TRANSACTION', details: `Deleted ${result.count} transaction(s) in range ${from||'…'} to ${to||'…'}${status?` (status ${status})`:''}` });
    res.json({ deleted: result.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FINANCE/ADMIN: mark an approved expense as processed with a processed date.
router.post('/:id/mark-processed', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { processedDate } = req.body;
    const e = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { submittedBy: true } });
    if (!e) return res.status(404).json({ error: 'Not found' });
    if (!['APPROVED', 'PROCESSED'].includes(e.status)) {
      return res.status(400).json({ error: 'Only approved expenses can be marked processed' });
    }
    const wasAlreadyProcessed = e.status === 'PROCESSED';
    const when = processedDate ? new Date(processedDate) : new Date();
    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { processedAt: when, status: 'PROCESSED' },
    });
    await logAudit(req.user, 'EXPENSE_MARKED_PROCESSED', { targetType: 'EXPENSE', targetId: req.params.id, details: `Marked "${e.title}" processed on ${when.toISOString().split('T')[0]}` });
    // Email the submitter the first time it's processed (skip re-marks / date edits).
    if (!wasAlreadyProcessed && e.submittedBy?.email) {
      try {
        const { sendStatusUpdateEmail } = require('../lib/email');
        sendStatusUpdateEmail(e.submittedBy.email, `${e.submittedBy.firstName || ''} ${e.submittedBy.lastName || ''}`.trim(), { ...updated, submittedBy: e.submittedBy }, 'PROCESSED', e.submittedBy).catch(() => {});
      } catch (mailErr) { console.error('processed email failed:', mailErr.message); }
    }
    res.json({ message: 'Marked processed', processedAt: updated.processedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FINANCE/ADMIN: undo processed tag (revert to APPROVED)
router.post('/:id/unmark-processed', authenticate, async (req, res) => {
  try {
    // Allowed: ADMIN always; otherwise only users in the org's payout-reversal list.
    let allowed = req.user.role === 'ADMIN';
    if (!allowed) {
      const org = await prisma.orgSettings.findFirst();
      let list = [];
      try { list = JSON.parse(org?.payoutReversalUserIds || '[]'); } catch (e) {}
      allowed = Array.isArray(list) && list.includes(req.user.id);
    }
    if (!allowed) return res.status(403).json({ error: 'You are not authorized to undo processed payouts. Ask an admin.' });
    const before = await prisma.expense.findUnique({ where: { id: req.params.id }, include: { submittedBy: true } });
    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { processedAt: null, payoutDate: null, payPeriod: null, status: 'APPROVED' },
    });
    // Tell the submitter their expense is back for reprocessing.
    if (before?.submittedBy?.email) {
      try {
        const { sendStatusUpdateEmail } = require('../lib/email');
        sendStatusUpdateEmail(before.submittedBy.email, `${before.submittedBy.firstName || ''} ${before.submittedBy.lastName || ''}`.trim(), { ...updated, submittedBy: before.submittedBy }, 'REPROCESSING', before.submittedBy).catch(() => {});
      } catch (mailErr) { /* ignore */ }
    }
    await logAudit(req.user, 'EXPENSE_PAYOUT_REVERSED', { targetType: 'EXPENSE', targetId: req.params.id, details: `Payout reversed (Undo) for "${before?.title || req.params.id}"` });
    res.json({ message: 'Unmarked', processedAt: updated.processedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk mark processed — select approved expenses, stamp a pay period + payout date.
router.post('/bulk-mark-processed', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { ids, payoutDate } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No expenses selected' });
    const when = payoutDate ? new Date(payoutDate) : new Date();
    const rows = await prisma.expense.findMany({ where: { id: { in: ids } }, include: { submittedBy: true } });
    const eligible = rows.filter(e => e.status === 'APPROVED' && !e.processedAt);
    let count = 0;
    for (const e of eligible) {
      const updated = await prisma.expense.update({
        where: { id: e.id },
        data: { status: 'PROCESSED', processedAt: when, payoutDate: when },
      });
      count++;
      if (e.submittedBy?.email) {
        try {
          const { sendStatusUpdateEmail } = require('../lib/email');
          sendStatusUpdateEmail(e.submittedBy.email, `${e.submittedBy.firstName || ''} ${e.submittedBy.lastName || ''}`.trim(), { ...updated, submittedBy: e.submittedBy }, 'PROCESSED', e.submittedBy).catch(() => {});
        } catch (mailErr) { /* ignore */ }
      }
    }
    await logAudit(req.user, 'EXPENSE_BULK_PROCESSED', { targetType: 'EXPENSE', details: `Marked ${count} expense(s) processed` });
    res.json({ message: `Marked ${count} expense(s) processed`, count, skipped: ids.length - count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update remarks on a single expense (Finance/Admin), used in the Transactions tab.
router.patch('/:id/remarks', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { remarks } = req.body || {};
    await prisma.expense.update({ where: { id: req.params.id }, data: { remarks: remarks ?? null } });
    res.json({ message: 'Remarks saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
