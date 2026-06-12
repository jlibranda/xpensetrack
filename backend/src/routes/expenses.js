// src/routes/expenses.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendApprovalRequestEmail } = require('../lib/email');
const { createNotification } = require('../lib/notifications');
const { logAudit } = require('../lib/audit');
const prisma = new PrismaClient();

const PHP_USD = 56;
const toPhp = (amt, cur) => cur === 'USD' ? amt * PHP_USD : amt;

const expenseInclude = {
  submittedBy: { select: { id:true, firstName:true, lastName:true, email:true, department:true, costCenter:true } },
  approvals: {
    include: { approver: { select: { id:true, firstName:true, lastName:true, role:true, email:true } } },
    orderBy: { createdAt: 'asc' },
  },
  receipt: { select: { id:true, mimeType:true, filename:true } },
};

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, category, from, to, page=1, limit=20 } = req.query;
    const where = {};
    if (req.user.role === 'EMPLOYEE') {
      where.submittedById = req.user.id;
    } else if (req.user.role === 'MANAGER') {
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

    let toApprove = 0;
    if (['MANAGER','FINANCE','ADMIN'].includes(req.user.role)) {
      if (req.user.role === 'ADMIN') {
        // Admin can act on any pending approval; count distinct expenses with a pending row.
        const rows = await prisma.approval.findMany({
          where: { status: 'PENDING' },
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
          where: { approverId: req.user.id, status: 'PENDING' },
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

    res.json({ myPending, toApprove });
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const e = await prisma.expense.findUnique({ where:{id:req.params.id}, include:expenseInclude });
    if(!e) return res.status(404).json({error:'Not found'});
    res.json(e);
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, amount, currency='PHP', category='OTHER',
            expenseType='REIMBURSEMENT', receiptId, costCenter, expenseDate } = req.body;
    if(!title||!amount||!expenseDate) return res.status(400).json({error:'title, amount, expenseDate required'});
    const expense = await prisma.expense.create({
      data: {
        title, description: description||null,
        amount: Number(amount), currency,
        amountPhp: toPhp(Number(amount), currency),
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

    const day = new Date(expenseDate);
    const start = new Date(day); start.setHours(0,0,0,0);
    const end = new Date(day); end.setHours(23,59,59,999);

    const orMatch = orNumber ? { orNumber: { equals: String(orNumber).trim(), mode: 'insensitive' } } : null;
    const merchMatch = merchant ? { merchant: { equals: String(merchant).trim(), mode: 'insensitive' } } : null;
    const orConds = [orMatch, merchMatch].filter(Boolean);

    const where = {
      submittedById: req.user.id,
      amount: Number(amount),
      expenseDate: { gte: start, lte: end },
      status: { not: 'CANCELLED' },
    };
    if (excludeId) where.id = { not: excludeId };
    if (orConds.length) where.OR = orConds;

    const duplicates = await prisma.expense.findMany({
      where,
      select: { id: true, title: true, merchant: true, orNumber: true, amount: true, currency: true, expenseDate: true, status: true },
      take: 5,
    });
    res.json({ duplicates });
  } catch(err){ res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, async (req, res) => {
  try {
    const e = await prisma.expense.findUnique({where:{id:req.params.id}});
    if(!e) return res.status(404).json({error:'Not found'});
    if(e.submittedById!==req.user.id && req.user.role==='EMPLOYEE') return res.status(403).json({error:'Forbidden'});
    if(!['DRAFT','REJECTED','CANCELLED'].includes(e.status)) return res.status(400).json({error:'Cannot edit in current status'});
    const { title, orNumber, merchant, description, amount, currency, category, expenseType, receiptId, costCenter, expenseDate } = req.body;
    const updated = await prisma.expense.update({
      where:{id:req.params.id},
      data:{
        title: title||(merchant?merchant:undefined), orNumber: orNumber!==undefined?orNumber||null:undefined, merchant: merchant!==undefined?merchant||null:undefined, description,
        amount: amount ? Number(amount) : undefined,
        currency, category, expenseType,
        receiptId: receiptId !== undefined ? (receiptId||null) : undefined,
        costCenter, amountPhp: amount ? toPhp(Number(amount), currency||e.currency) : undefined,
        expenseDate: expenseDate ? new Date(expenseDate) : undefined,
        status: 'DRAFT',
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
    if(!['DRAFT','REJECTED','CANCELLED'].includes(expense.status)) return res.status(400).json({error:'Already submitted'});

    const submitter = expense.submittedBy;

    // Approver #1 is ALWAYS the assigned manager. Additional approvers (#2..#5)
    // come from approverIds. Manager + up to 4 more = 5 total.
    const additional = (submitter.approverIds || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    let approverIds = [];
    if (submitter.managerId) approverIds.push(submitter.managerId);
    approverIds.push(...additional);

    // No approver/manager assigned -> auto-approve on submission.
    if (approverIds.length === 0) {
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
    // De-dupe while preserving order (manager stays #1); cap at 5
    approverIds = [...new Set(approverIds)].slice(0, 5);

    const mode = submitter.approvalMode || 'SEQUENTIAL'; // ordering: SEQUENTIAL | ANY_ORDER
    const rule = submitter.approvalRule || 'ALL';        // completion: ALL | ANY

    // Map to approval rows.
    //  - ALL rule: each approver is its own step (must all approve). stepOrder = position.
    //  - ANY rule: all approvers share one step/group (any one satisfies it).
    let approvalRows;
    if (rule === 'ANY') {
      const groupKey = `${expense.id}:any`;
      approvalRows = approverIds.map((id) => ({ approverId: id, stepOrder: 1, groupKey }));
    } else {
      approvalRows = approverIds.map((id, idx) => ({ approverId: id, stepOrder: idx + 1, groupKey: null }));
    }

    await prisma.$transaction([
      prisma.expense.update({where:{id:expense.id}, data:{status:'PENDING'}}),
      prisma.approval.deleteMany({where:{expenseId:expense.id}}),
      ...approvalRows.map((r) => prisma.approval.create({ data: {
        expenseId: expense.id,
        approverId: r.approverId,
        level: r.stepOrder,
        stepOrder: r.stepOrder,
        groupKey: r.groupKey,
        status: 'PENDING',
      }})),
    ]);

    // Who is actionable right now?
    //  - ANY rule: everyone (one approval finishes it).
    //  - ALL + ANY_ORDER: everyone at once.
    //  - ALL + SEQUENTIAL: only the first step.
    let notifyRows;
    if (rule === 'ANY' || mode === 'ANY_ORDER') notifyRows = approvalRows;
    else notifyRows = approvalRows.filter(r => r.stepOrder === 1);

    const notifiedIds = [...new Set(notifyRows.map(r => r.approverId))];
    for (const approverId of notifiedIds) {
      const approver = await prisma.user.findUnique({ where: { id: approverId } });
      if (approver) {
        await sendApprovalRequestEmail(approver.email, `${approver.firstName||''} ${approver.lastName||''}`.trim(), expense).catch(()=>{});
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
    if(!['DRAFT','CANCELLED','REJECTED'].includes(e.status)) return res.status(400).json({error:'Cannot delete'});
    await prisma.approval.deleteMany({where:{expenseId:e.id}});
    await prisma.expense.delete({where:{id:e.id}});
    res.json({message:'Deleted'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// ADMIN: permanently delete ALL expenses within a date range (by expenseDate).
// Optional status filter; if omitted, deletes every status in range.
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
    const e = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!e) return res.status(404).json({ error: 'Not found' });
    if (!['APPROVED', 'REIMBURSED'].includes(e.status)) {
      return res.status(400).json({ error: 'Only approved expenses can be marked processed' });
    }
    const when = processedDate ? new Date(processedDate) : new Date();
    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { processedAt: when },
    });
    await logAudit(req.user, 'EXPENSE_MARKED_PROCESSED', { targetType: 'EXPENSE', targetId: req.params.id, details: `Marked "${e.title}" processed on ${when.toISOString().split('T')[0]}` });
    res.json({ message: 'Marked processed', processedAt: updated.processedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FINANCE/ADMIN: undo processed tag
router.post('/:id/unmark-processed', authenticate, requireRole('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { processedAt: null },
    });
    res.json({ message: 'Unmarked', processedAt: updated.processedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
