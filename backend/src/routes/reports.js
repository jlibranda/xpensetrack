// src/routes/reports.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');
const prisma = new PrismaClient();

// For a MANAGER, reports are limited to employees they approve for:
// either as the manager (#1) or listed in that employee's additional approverIds.
// FINANCE and ADMIN see everyone (returns null = no restriction).
// IDs of people who report to this user OR that this user is an approver for
// (does NOT include the user themselves).
async function teamMemberIds(userId) {
  const everyone = await prisma.user.findMany({ select: { id: true, managerId: true, approverIds: true, approvalFlowJson: true } });
  const ids = new Set();
  for (const u of everyone) {
    if (u.id === userId) continue;
    if (u.managerId === userId) { ids.add(u.id); continue; }
    const additional = (u.approverIds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (additional.includes(userId)) { ids.add(u.id); continue; }
    // Also check the structured approval flow steps.
    if (u.approvalFlowJson) {
      try {
        const steps = JSON.parse(u.approvalFlowJson);
        if (Array.isArray(steps) && steps.some(s => (s.approvers || []).includes(userId))) ids.add(u.id);
      } catch (e) { /* ignore */ }
    }
  }
  return [...ids];
}

async function teamScopeFilter(reqUser) {
  if (reqUser.role !== 'MANAGER') return null; // FINANCE/ADMIN: unrestricted

  const everyone = await prisma.user.findMany({ select: { id: true, managerId: true, approverIds: true } });
  const ids = new Set();
  for (const u of everyone) {
    if (u.managerId === reqUser.id) { ids.add(u.id); continue; }
    const additional = (u.approverIds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (additional.includes(reqUser.id)) ids.add(u.id);
  }
  // Always allow a manager to see their own expenses too.
  ids.add(reqUser.id);
  return [...ids];
}

// GET /api/reports/summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    const { from, to, scope } = req.query;
    const role = req.user.role;
    const where = {};
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(String(from).split('T')[0]);
      if (to) where.expenseDate.lte = new Date(String(to).split('T')[0] + 'T23:59:59');
    }

    // Determine the user set based on the requested scope + what the role is allowed.
    //  self  -> only the user's own expenses
    //  team  -> people who report to / are approved by the user
    //  all   -> company-wide (FINANCE/ADMIN only)
    // ADMIN defaults to ALL (full visibility, no tabs).
    let requested = scope || (role === 'ADMIN' ? 'all' : 'self');

    // Enforce permissions: only FINANCE/ADMIN may use 'all'.
    if (requested === 'all' && !['FINANCE', 'ADMIN'].includes(role)) requested = 'team';

    if (requested === 'self') {
      where.submittedById = req.user.id;
    } else if (requested === 'team') {
      const team = await teamMemberIds(req.user.id);
      // Team view = the people under them (not their own self expenses).
      where.submittedById = { in: team.length ? team : ['__none__'] };
    } // 'all' -> no submittedById filter (company-wide)

    const [approved, pending, rejected, all] = await Promise.all([
      prisma.expense.findMany({ where: { ...where, status: { in: ['APPROVED', 'PROCESSED'] } }, include: { submittedBy: { select: { firstName: true, lastName: true, department: true } } } }),
      prisma.expense.count({ where: { ...where, status: 'PENDING' } }),
      prisma.expense.count({ where: { ...where, status: 'REJECTED' } }),
      prisma.expense.count({ where }),
    ]);

    const totalPhp = approved.reduce((s, e) => s + e.amountPhp, 0);
    // Split the approved+processed set into the two distinct statuses.
    const approvedOnly = approved.filter(e => e.status === 'APPROVED');
    const processedOnly = approved.filter(e => e.status === 'PROCESSED');
    const approvedPhp = approvedOnly.reduce((s, e) => s + e.amountPhp, 0);
    const processedPhp = processedOnly.reduce((s, e) => s + e.amountPhp, 0);
    const byCategory = approved.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amountPhp; return acc; }, {});
    const byEmployee = approved.reduce((acc, e) => { const k = `${e.submittedBy.firstName||''} ${e.submittedBy.lastName||''}`.trim(); acc[k] = (acc[k] || 0) + e.amountPhp; return acc; }, {});
    const byDepartment = approved.reduce((acc, e) => { const k = e.submittedBy.department || 'Unknown'; acc[k] = (acc[k] || 0) + e.amountPhp; return acc; }, {});

    res.json({ scope: requested, totalPhp, count: approved.length,
      approvedPhp, approvedCount: approvedOnly.length,
      processedPhp, processedCount: processedOnly.length,
      pendingCount: pending, rejectedCount: rejected, totalCount: all,
      byCategory, byEmployee, byDepartment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/dashboard — quick stats for dashboard
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user.role === 'EMPLOYEE' ? req.user.id : undefined;
    const where = userId ? { submittedById: userId } : {};
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [thisMonth, pending, approved, reimbursed] = await Promise.all([
      prisma.expense.aggregate({ _sum: { amountPhp: true }, _count: true, where: { ...where, expenseDate: { gte: monthStart } } }),
      prisma.expense.aggregate({ _sum: { amountPhp: true }, _count: true, where: { ...where, status: 'PENDING' } }),
      prisma.expense.aggregate({ _sum: { amountPhp: true }, _count: true, where: { ...where, status: 'APPROVED' } }),
      prisma.expense.aggregate({ _sum: { amountPhp: true }, _count: true, where: { ...where, status: 'PROCESSED' } }),
    ]);

    res.json({
      thisMonth: { amount: thisMonth._sum.amountPhp || 0, count: thisMonth._count },
      pending: { amount: pending._sum.amountPhp || 0, count: pending._count },
      approved: { amount: approved._sum.amountPhp || 0, count: approved._count },
      reimbursed: { amount: reimbursed._sum.amountPhp || 0, count: reimbursed._count },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/export — Excel download
router.get('/export', authenticate, requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { from, to, userId, status, processed } = req.query;
    const where = {};
    if (userId) where.submittedById = userId;
    if (from || to) {
      where.expenseDate = {};
      if (from) where.expenseDate.gte = new Date(String(from).split('T')[0]);
      if (to) where.expenseDate.lte = new Date(String(to).split('T')[0] + 'T23:59:59');
    }
    if (status) where.status = status;
    if (processed === 'yes') where.processedAt = { not: null };
    else if (processed === 'no') where.processedAt = null;

    const scope = await teamScopeFilter(req.user);
    if (scope) {
      where.submittedById = where.submittedById && scope.includes(where.submittedById)
        ? where.submittedById
        : { in: scope };
    }

    // GL code mapping by category (from org settings) used as a fallback when
    // an expense has no explicit glCode.
    let glCodes = {};
    try {
      const org = await prisma.orgSettings.findFirst();
      if (org?.categoryGlCodes) {
        const raw = JSON.parse(org.categoryGlCodes);
        glCodes = Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k).trim().toUpperCase(), v]));
      }
    } catch (e) { glCodes = {}; }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        submittedBy: { select: { firstName: true, lastName: true, email: true, department: true, employeeNumber: true, costCenter: true } },
        approvals: { include: { approver: { select: { firstName: true, lastName: true } } }, orderBy: { stepOrder: 'asc' } },
      },
      orderBy: { expenseDate: 'desc' },
    });

    const fmtDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
    const rows = expenses.map(e => ({
      'Date': fmtDate(e.expenseDate),
      'Employee Number': e.submittedBy.employeeNumber || '',
      'Employee Full Name': `${e.submittedBy.lastName||''}, ${e.submittedBy.firstName||''}`.replace(/^,\s*|,\s*$/g, '').trim(),
      'Department': e.submittedBy.department || '',
      'Cost Center': e.costCenter || e.submittedBy.costCenter || '',
      'Description': e.title || '',
      'Notes': e.description || '',
      'Category': e.category || '',
      'GL Code': e.glCode || glCodes[String(e.category || '').trim().toUpperCase()] || '',
      'Type': e.expenseType || '',
      'Amount': e.amount,
      'Currency': e.currency,
      'Amount (PHP)': Number(e.amountPhp.toFixed(2)),
      'Status': e.status,
      'Processed': e.processedAt ? 'Yes' : 'No',
      'Processed / Payout Date': fmtDate(e.processedAt),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      {wch:12},{wch:16},{wch:26},{wch:16},{wch:14},{wch:30},{wch:25},
      {wch:18},{wch:12},{wch:16},{wch:12},{wch:8},{wch:14},{wch:12},{wch:11},{wch:20}
    ];
    // Bold header row
    const headerRange = XLSX.utils.decode_range(ws['!ref']);
    for (let C = headerRange.s.c; C <= headerRange.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!ws[addr]) continue;
      ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: '1D9E75' } } };
    }
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');

    // Summary sheet
    const totalPhp = expenses.filter(e => ['APPROVED','PROCESSED'].includes(e.status)).reduce((s,e) => s+e.amountPhp, 0);
    const summaryData = [
      { 'Metric': 'Total Expenses', 'Value': expenses.length },
      { 'Metric': 'Total Approved (PHP)', 'Value': Number(totalPhp.toFixed(2)) },
      { 'Metric': 'Pending', 'Value': expenses.filter(e=>e.status==='PENDING').length },
      { 'Metric': 'Approved', 'Value': expenses.filter(e=>e.status==='APPROVED').length },
      { 'Metric': 'Processed', 'Value': expenses.filter(e=>e.processedAt).length },
      { 'Metric': 'Rejected', 'Value': expenses.filter(e=>e.status==='REJECTED').length },
      { 'Metric': 'Report Generated', 'Value': new Date().toLocaleString() },
    ];
    const ws2 = XLSX.utils.json_to_sheet(summaryData);
    ws2['!cols'] = [{wch:25},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `expenses-${from || 'all'}-to-${to || 'all'}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
