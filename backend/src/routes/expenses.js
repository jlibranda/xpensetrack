// src/routes/expenses.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { sendApprovalRequestEmail } = require('../lib/email');
const { createNotification } = require('../lib/notifications');
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
    // For employees: count their own pending expenses
    // For managers: count pending approvals waiting for them
    const [myPending, toApprove] = await Promise.all([
      prisma.expense.count({ where: { submittedById: req.user.id, status: 'PENDING' } }),
      ['MANAGER','FINANCE','ADMIN'].includes(req.user.role)
        ? prisma.approval.count({ where: { approverId: req.user.id, status: 'PENDING' } })
        : Promise.resolve(0),
    ]);
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
      include:{
        submittedBy:{ include:{
          manager:true,
          approvalChain:{ include:{ steps:{ orderBy:{order:'asc'}, include:{ approvers:true } } } },
        } } },
    });
    if(!expense) return res.status(404).json({error:'Not found'});
    if(expense.submittedById!==req.user.id) return res.status(403).json({error:'Forbidden'});
    if(!['DRAFT','REJECTED','CANCELLED'].includes(expense.status)) return res.status(400).json({error:'Already submitted'});

    // Build the approval steps from the employee's assigned approval chain.
    const chain = expense.submittedBy.approvalChain;
    let approvalRows = [];   // {approverId, stepOrder, groupKey, status}
    let chainMode = 'SEQUENTIAL';

    if (chain && chain.steps && chain.steps.length > 0) {
      chainMode = chain.mode;
      chain.steps.forEach((step) => {
        const groupKey = `${chain.id}:${step.order}`;
        // For SEQUENTIAL: only step 1 starts PENDING, the rest start as WAITING (modelled as PENDING but gated).
        // We store all as PENDING but the approve logic only opens later steps once earlier ones complete.
        step.approvers.forEach((a) => {
          approvalRows.push({
            approverId: a.approverId,
            stepOrder: step.order,
            groupKey,
            // In SEQUENTIAL mode only step 1 is actionable initially; others are created but gated by stepOrder.
            status: 'PENDING',
          });
        });
      });
    } else {
      // Fallback: no chain assigned -> use the manager as a single-step approver.
      const manager = expense.submittedBy.manager;
      if (!manager) {
        return res.status(400).json({ error: 'No approval chain or manager assigned. Please ask your admin to assign an approval chain.' });
      }
      approvalRows.push({ approverId: manager.id, stepOrder: 1, groupKey: null, status: 'PENDING' });
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

    // Notify the approvers who are actionable now.
    // SEQUENTIAL: only step 1. ANY_ORDER: everyone.
    const actionable = chainMode === 'ANY_ORDER'
      ? approvalRows
      : approvalRows.filter(r => r.stepOrder === Math.min(...approvalRows.map(x => x.stepOrder)));
    const notifiedIds = [...new Set(actionable.map(r => r.approverId))];
    for (const approverId of notifiedIds) {
      const approver = await prisma.user.findUnique({ where: { id: approverId } });
      if (approver) {
        await sendApprovalRequestEmail(approver.email, `${approver.firstName||''} ${approver.lastName||''}`.trim(), expense).catch(()=>{});
        await createNotification(approverId, 'APPROVAL_REQUEST',
          'New expense to approve',
          `${expense.submittedBy.firstName} ${expense.submittedBy.lastName} submitted "${expense.title}" for approval`,
          '/approvals'
        );
      }
    }
    // Notify submitter their expense is pending
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

module.exports = router;
