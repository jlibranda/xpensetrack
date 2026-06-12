// src/routes/approvals.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../lib/email');
const { createNotification } = require('../lib/notifications');
const prisma = new PrismaClient();

const expenseInclude = {
  submittedBy: { select:{id:true,firstName:true,lastName:true,email:true,department:true} },
  approvals: { include:{approver:{select:{firstName:true,lastName:true,role:true}}}, orderBy:{level:'asc'} },
  receipt: { select:{id:true,mimeType:true} },
};

router.get('/pending', authenticate, requireRole('MANAGER','FINANCE','ADMIN'), async (req,res) => {
  try {
    // ADMIN sees every pending approval (override capability); others see only their own.
    const where = req.user.role === 'ADMIN'
      ? { status:'PENDING' }
      : { approverId:req.user.id, status:'PENDING' };
    const approvals = await prisma.approval.findMany({
      where,
      include:{ expense:{ include: expenseInclude } },
      orderBy:{ createdAt:'desc' },
    });
    res.json(approvals);
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.get('/history', authenticate, requireRole('MANAGER','FINANCE','ADMIN'), async (req,res) => {
  try {
    const approvals = await prisma.approval.findMany({
      where:{ approverId:req.user.id, status:{not:'PENDING'} },
      include:{ expense:{ include:{ submittedBy:{select:{id:true,firstName:true,lastName:true}}, receipt:{select:{id:true,mimeType:true}} } } },
      orderBy:{ updatedAt:'desc' },
      take:100,
    });
    res.json(approvals);
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/approve', authenticate, requireRole('MANAGER','FINANCE','ADMIN'), async (req,res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where:{id:req.params.id},
      include:{ expense:{ include:{submittedBy:true} } },
    });
    if(!approval) return res.status(404).json({error:'Not found'});
    if(approval.approverId!==req.user.id && req.user.role!=='ADMIN') return res.status(403).json({error:'Not your approval'});
    if(approval.status!=='PENDING') return res.status(400).json({error:'Already actioned'});

    const settings = await prisma.orgSettings.findFirst();
    const levels = settings?.approvalLevels || 2;
    await prisma.approval.update({where:{id:approval.id}, data:{status:'APPROVED',notes}});

    let finalStatus = 'APPROVED';
    if(approval.level===1 && levels>=2) {
      // Level 2 = the ASSIGNED level-1 approver's manager (walk one step up the
      // chain). We base this on the approval's assigned approver, NOT on whoever
      // clicked approve — otherwise an ADMIN override would mis-route the chain.
      // If that manager doesn't exist, fall back to a FINANCE user. Never auto-route to ADMIN.
      const assignedApprover = await prisma.user.findUnique({
        where: { id: approval.approverId },
        include: { manager: true },
      });
      let nextApprover = assignedApprover?.manager || null;

      // Don't let the chain loop back to the submitter or the assigned approver
      if (nextApprover && (nextApprover.id === approval.expense.submittedById || nextApprover.id === approval.approverId)) {
        nextApprover = null;
      }
      // Fallback: a FINANCE user (never ADMIN automatically), excluding submitter & assigned approver
      if (!nextApprover) {
        nextApprover = await prisma.user.findFirst({
          where: { role: 'FINANCE', id: { notIn: [approval.approverId, approval.expense.submittedById] } },
        });
      }

      if (nextApprover) {
        await prisma.approval.create({data:{expenseId:approval.expenseId, approverId:nextApprover.id, level:2, status:'PENDING'}});
        finalStatus = 'PENDING';
        await createNotification(nextApprover.id, 'APPROVAL_REQUEST', 'Expense needs second-level approval',
          `"${approval.expense.title}" was approved at level 1 and needs your review`, '/approvals');
      }
      // If no eligible level-2 approver exists, level-1 approval is final (status stays APPROVED).
    }
    await prisma.expense.update({where:{id:approval.expenseId}, data:{status:finalStatus}});

    const statusKey = finalStatus==='PENDING' ? 'MANAGER_APPROVED' : 'APPROVED';
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, statusKey).catch(()=>{});
    await createNotification(approval.expense.submittedById, 'EXPENSE_'+statusKey,
      finalStatus==='PENDING' ? 'Manager approved your expense' : 'Expense fully approved!',
      `"${approval.expense.title}" ${finalStatus==='PENDING'?'was approved by your manager and is pending finance review':'has been fully approved'}`,
      '/expenses');

    res.json({message:'Approved', finalStatus});
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/reject', authenticate, requireRole('MANAGER','FINANCE','ADMIN'), async (req,res) => {
  try {
    const { notes } = req.body;
    const approval = await prisma.approval.findUnique({
      where:{id:req.params.id},
      include:{ expense:{include:{submittedBy:true}} },
    });
    if(!approval) return res.status(404).json({error:'Not found'});
    if(approval.approverId!==req.user.id && req.user.role!=='ADMIN') return res.status(403).json({error:'Not your approval'});
    if(approval.status!=='PENDING') return res.status(400).json({error:'Already actioned'});
    await Promise.all([
      prisma.approval.update({where:{id:approval.id}, data:{status:'REJECTED',notes}}),
      prisma.expense.update({where:{id:approval.expenseId}, data:{status:'REJECTED'}}),
    ]);
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, 'REJECTED').catch(()=>{});
    await createNotification(approval.expense.submittedById, 'EXPENSE_REJECTED',
      'Expense rejected', `"${approval.expense.title}" was rejected${notes?`: ${notes}`:''}`, '/expenses');
    res.json({message:'Rejected'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/return', authenticate, requireRole('MANAGER','FINANCE','ADMIN'), async (req,res) => {
  try {
    const { notes } = req.body;
    if(!notes) return res.status(400).json({error:'Comment required when returning'});
    const approval = await prisma.approval.findUnique({
      where:{id:req.params.id},
      include:{ expense:{include:{submittedBy:true}} },
    });
    if(!approval) return res.status(404).json({error:'Not found'});
    if(approval.approverId!==req.user.id && req.user.role!=='ADMIN') return res.status(403).json({error:'Not your approval'});
    await Promise.all([
      prisma.approval.update({where:{id:approval.id}, data:{status:'REJECTED', notes:`[RETURNED] ${notes}`}}),
      prisma.expense.update({where:{id:approval.expenseId}, data:{status:'REJECTED'}}),
    ]);
    await sendStatusUpdateEmail(approval.expense.submittedBy.email, `${approval.expense.submittedBy.firstName} ${approval.expense.submittedBy.lastName}`, approval.expense, 'RETURNED').catch(()=>{});
    await createNotification(approval.expense.submittedById, 'EXPENSE_RETURNED',
      'Expense returned for revision', `"${approval.expense.title}" was returned: ${notes}`, '/expenses');
    res.json({message:'Returned'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

router.post('/:id/reimburse', authenticate, requireRole('FINANCE','ADMIN'), async (req,res) => {
  try {
    const expense = await prisma.expense.findUnique({where:{id:req.params.id}, include:{submittedBy:true}});
    if(!expense) return res.status(404).json({error:'Not found'});
    if(expense.status!=='APPROVED') return res.status(400).json({error:'Must be approved first'});
    await prisma.expense.update({where:{id:req.params.id}, data:{status:'REIMBURSED'}});
    await sendStatusUpdateEmail(expense.submittedBy.email, `${expense.submittedBy.firstName} ${expense.submittedBy.lastName}`, expense, 'REIMBURSED').catch(()=>{});
    await createNotification(expense.submittedById, 'EXPENSE_REIMBURSED',
      '💰 Expense reimbursed!', `"${expense.title}" has been reimbursed`, '/expenses');
    res.json({message:'Reimbursed'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

module.exports = router;
