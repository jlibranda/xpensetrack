// src/routes/ledger.js
// AP/AR documents (payables & receivables). Reuses the Receipt model for the
// attached file and the OCR /scan endpoint for extraction (done client-side).
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requirePermission, requireRole, hasPermission } = require('../middleware/auth');
const { getUsdPhpRate } = require('../lib/fxrate');
const { getFlowSteps, buildRowsFromSteps } = require('../lib/approvalChain');
const { createNotification } = require('../lib/notifications');
const { logAudit } = require('../lib/audit');
const { sendApprovalRequestEmail, sendStatusUpdateEmail } = require('../lib/email');
const XLSX = require('xlsx');
const { signReceiptToken } = require('../lib/receipt-token');
const prisma = new PrismaClient();

// Team = users who report to / are approved by this user (mirrors expenses + reports).
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

const nm = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
// Shape a LedgerDoc like an expense so the shared email templates work (matches approvals.js).
function ledgerAsExpense(doc, creator) {
  return {
    id: doc.id,
    title: `${doc.vendorName || 'AP/AR document'}${doc.docNumber ? ` \u2014 ${doc.docNumber}` : ''}`,
    amount: doc.amount != null ? doc.amount : (doc.amountPhp || 0),
    currency: doc.currency || 'PHP',
    expenseDate: doc.docDate || doc.createdAt || new Date(),
    category: doc.category || '',
    description: doc.notes || '',
    remarks: doc.remarks || '',
    payoutDate: doc.payoutDate || doc.processedAt || null,
    processedAt: doc.processedAt || null,
    submittedBy: creator || null,
    submittedById: doc.createdById || null,
  };
}

const PERM = 'manage_ap_ar';
const FALLBACK = ['FINANCE', 'ADMIN'];
// Viewing the AP/AR list is allowed for managers of AP/AR OR approvers (view_approvals),
// so people who approved an invoice can still review it after it's rejected/returned.
// Mutations keep the stricter manage_ap_ar check.
const canViewLedger = async (req, res, next) => {
  try {
    const ok = (await hasPermission(req.user, PERM, FALLBACK)) ||
               (await hasPermission(req.user, 'view_approvals', ['MANAGER', 'FINANCE', 'ADMIN']));
    if (!ok) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
const DOC_TYPES = ['AP_INVOICE', 'AP_RECEIPT', 'AR_INVOICE'];
// Expense-aligned statuses (Phase 2) + legacy stages kept for backward compatibility.
const STAGES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'PROCESSED', 'FOR_VERIFICATION', 'FOR_APPROVAL', 'PAID'];
const normStatus = (s) => STAGES.includes(String(s || '').toUpperCase()) ? String(s).toUpperCase() : 'DRAFT';
const VAT_RATE = 0.12;

const toPhp = async (amt, cur) => {
  if (!amt) return 0;
  if (cur !== 'USD') return amt;
  const rate = await getUsdPhpRate();
  return amt * rate;
};

const include = {
  client: { select: { id: true, name: true } },
  receipt: { select: { id: true, mimeType: true, filename: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  lastEditedBy: { select: { id: true, firstName: true, lastName: true } },
  approvals: { include: { approver: { select: { id: true, firstName: true, lastName: true, role: true } } }, orderBy: { stepOrder: 'asc' } },
};

// Compute VATable / VAT from a VAT-inclusive total when not provided.
function fillVat(amount, vatable, vat) {
  const amt = Number(amount) || 0;
  if (vatable != null && vat != null) return { vatableAmount: Number(vatable), vatAmount: Number(vat) };
  const net = amt / (1 + VAT_RATE);
  return { vatableAmount: +net.toFixed(2), vatAmount: +(amt - net).toFixed(2) };
}

function normalizeType(t) {
  const up = String(t || '').toUpperCase();
  return DOC_TYPES.includes(up) ? up : 'AP_INVOICE';
}

// ---- list + summary ------------------------------------------------------

router.get('/', authenticate, canViewLedger, async (req, res) => {
  try {
    const { docType, status, clientId, q, from, to, archived, assignedToId, scope } = req.query;
    const where = {};
    where.archived = archived === '1' || archived === 'true';
    // Scope toggle (mirrors My Expenses): self | team | all. Owner = createdById.
    // Only applied when a scope is explicitly requested, so Transactions/Reports/
    // Analytics (which don't pass scope) keep seeing everything they're allowed to.
    if (scope) {
      let requested = scope;
      if (requested === 'all' && !['FINANCE', 'ADMIN'].includes(req.user.role)) requested = 'team';
      if (requested === 'self') {
        // Own OR assigned to me — so nothing you're responsible for disappears
        // (e.g. after an invoice is returned/rejected back to you).
        where.AND = [{ OR: [{ createdById: req.user.id }, { assignedToId: req.user.id }] }];
      } else if (requested === 'team') {
        const team = await teamMemberIds(req.user.id);
        const ids = [req.user.id, ...team];
        where.AND = [{ OR: [{ createdById: { in: ids } }, { assignedToId: { in: ids } }] }];
      } // 'all' -> no owner filter
    }
    if (docType) {
      if (docType === 'AP') where.docType = { in: ['AP_INVOICE', 'AP_RECEIPT'] };
      else if (docType === 'AR') where.docType = 'AR_INVOICE';
      else where.docType = normalizeType(docType);
    }
    if (status) where.status = String(status).toUpperCase();
    if (clientId) where.clientId = clientId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (from || to) {
      where.docDate = {};
      if (from) where.docDate.gte = new Date(String(from).split('T')[0]);
      if (to) where.docDate.lte = new Date(String(to).split('T')[0] + 'T23:59:59');
    }
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { vendorName: { contains: term, mode: 'insensitive' } },
        { docNumber: { contains: term, mode: 'insensitive' } },
        { poNumber: { contains: term, mode: 'insensitive' } },
        { vendorTin: { contains: term, mode: 'insensitive' } },
      ];
    }
    const docs = await prisma.ledgerDoc.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary', authenticate, canViewLedger, async (req, res) => {
  try {
    const { clientId } = req.query;
    const base = clientId ? { clientId, archived: false } : { archived: false };
    const all = await prisma.ledgerDoc.findMany({ where: base, select: { docType: true, status: true, amountPhp: true } });
    const isAP = (t) => t === 'AP_INVOICE' || t === 'AP_RECEIPT';
    const sum = (rows) => +rows.reduce((s, r) => s + (r.amountPhp || 0), 0).toFixed(2);
    const apUnpaid = all.filter(d => isAP(d.docType) && d.status !== 'PAID');
    const arUnpaid = all.filter(d => d.docType === 'AR_INVOICE' && d.status !== 'PAID');
    const apPaid = all.filter(d => isAP(d.docType) && d.status === 'PAID');
    const arPaid = all.filter(d => d.docType === 'AR_INVOICE' && d.status === 'PAID');
    res.json({
      payablesOutstanding: sum(apUnpaid), payablesOutstandingCount: apUnpaid.length,
      receivablesOutstanding: sum(arUnpaid), receivablesOutstandingCount: arUnpaid.length,
      payablesPaid: sum(apPaid), receivablesPaid: sum(arPaid),
      total: all.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/export', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { docType, status, from, to, payoutDate, archived } = req.query;
    const where = { archived: archived === '1' || archived === 'true' };
    if (docType && docType !== 'ALL') {
      if (docType === 'AP') where.docType = { in: ['AP_INVOICE', 'AP_RECEIPT'] };
      else if (docType === 'AR') where.docType = 'AR_INVOICE';
      else where.docType = String(docType).toUpperCase();
    }
    if (status) where.status = String(status).toUpperCase();
    if (from || to) {
      where.docDate = {};
      if (from) where.docDate.gte = new Date(String(from).split('T')[0]);
      if (to) where.docDate.lte = new Date(String(to).split('T')[0] + 'T23:59:59');
    }
    if (payoutDate) {
      const d0 = new Date(payoutDate + 'T00:00:00.000Z');
      const d1 = new Date(payoutDate + 'T23:59:59.999Z');
      where.OR = [
        { payoutDate: { gte: d0, lte: d1 } },
        { payoutDate: null, processedAt: { gte: d0, lte: d1 } },
      ];
    }

    let glCodes = {};
    try {
      const org = await prisma.orgSettings.findFirst();
      if (org?.categoryGlCodes) {
        const raw = JSON.parse(org.categoryGlCodes);
        glCodes = Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k).trim().toUpperCase(), v]));
      }
    } catch (e) { glCodes = {}; }

    const docs = await prisma.ledgerDoc.findMany({
      where,
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { docDate: 'desc' },
    });

    const fmtDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
    const typeLabel = (t) => t === 'AR_INVOICE' ? 'AR Invoice' : t === 'AP_RECEIPT' ? 'AP Receipt' : 'AP Invoice';
    const rows = docs.map(d => ({
      'Date': fmtDate(d.docDate),
      'Type': typeLabel(d.docType),
      'Vendor / Payee': d.vendorName || '',
      'Vendor TIN': d.vendorTin || '',
      'Doc/Invoice No.': d.docNumber || '',
      'PO No.': d.poNumber || '',
      'Category': d.category || '',
      'GL Code': glCodes[String(d.category || '').trim().toUpperCase()] || '',
      'Frequency': d.frequency || '',
      'Amount': d.amount,
      'Currency': d.currency,
      'Amount (PHP)': Number((d.amountPhp || 0).toFixed(2)),
      'VATable (PHP)': Number(((d.amountPhp || 0) / 1.12).toFixed(2)),
      'VAT (PHP)': Number(((d.amountPhp || 0) - (d.amountPhp || 0) / 1.12).toFixed(2)),
      'Due Date': fmtDate(d.dueDate),
      'Status': d.status,
      'Processed': d.processedAt ? 'Yes' : 'No',
      'Pay Out Date': fmtDate(d.payoutDate || d.processedAt),
      'Remarks': d.remarks || '',
      'Created By': d.createdBy ? `${d.createdBy.lastName || ''}, ${d.createdBy.firstName || ''}`.replace(/^,\s*|,\s*$/g, '').trim() : '',
      'Document': d.receiptId ? 'View document' : '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:12},{wch:26},{wch:14},{wch:16},{wch:12},{wch:18},{wch:12},{wch:12},{wch:12},{wch:8},{wch:14},{wch:14},{wch:12},{wch:12},{wch:12},{wch:10},{wch:14},{wch:24},{wch:22},{wch:16}];
    const headerRange = XLSX.utils.decode_range(ws['!ref']);
    const colOf = {};
    for (let C = headerRange.s.c; C <= headerRange.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!ws[addr]) continue;
      colOf[ws[addr].v] = C;
      ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: '1D9E75' } } };
    }
    const apiBase = (process.env.PUBLIC_API_URL || 'https://xpensetrack-production.up.railway.app/api').replace(/\/$/, '');
    for (let i = 0; i < docs.length; i++) {
      const colIdx = colOf['Document'];
      if (colIdx == null || !docs[i].receiptId) continue;
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: colIdx });
      if (!ws[addr]) continue;
      ws[addr].l = { Target: `${apiBase}/ocr/receipt/${docs[i].receiptId}?token=${signReceiptToken(docs[i].receiptId)}`, Tooltip: 'Open document' };
      ws[addr].s = { font: { color: { rgb: '1155CC' }, underline: true } };
    }
    XLSX.utils.book_append_sheet(wb, ws, 'AP-AR Invoices');

    const approvedPhp = docs.filter(d => ['APPROVED','PROCESSED'].includes(d.status)).reduce((s,d)=>s+(d.amountPhp||0),0);
    const summaryData = [
      { 'Metric': 'Total invoices', 'Value': docs.length },
      { 'Metric': 'Approved/Processed (PHP)', 'Value': Number(approvedPhp.toFixed(2)) },
      { 'Metric': 'Pending', 'Value': docs.filter(d=>d.status==='PENDING').length },
      { 'Metric': 'Approved', 'Value': docs.filter(d=>d.status==='APPROVED').length },
      { 'Metric': 'Processed', 'Value': docs.filter(d=>d.processedAt).length },
      { 'Metric': 'AP invoices', 'Value': docs.filter(d=>d.docType!=='AR_INVOICE').length },
      { 'Metric': 'AR invoices', 'Value': docs.filter(d=>d.docType==='AR_INVOICE').length },
      { 'Metric': 'Report generated', 'Value': new Date().toLocaleString() },
    ];
    const ws2 = XLSX.utils.json_to_sheet(summaryData);
    ws2['!cols'] = [{wch:26},{wch:22}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="ap-ar-${from || 'all'}-to-${to || 'all'}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const doc = await prisma.ledgerDoc.findUnique({ where: { id: req.params.id }, include });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- create / bulk / update ---------------------------------------------

async function buildData(body) {
  const amount = Number(body.amount) || 0;
  const currency = body.currency || 'PHP';
  const { vatableAmount, vatAmount } = fillVat(amount, body.vatableAmount, body.vatAmount);
  const status = normStatus(body.status);
  return {
    docType: normalizeType(body.docType),
    clientId: body.clientId || null,
    vendorName: body.vendorName || null,
    vendorTin: body.vendorTin || null,
    businessStyle: body.businessStyle || null,
    docNumber: body.docNumber || null,
    poNumber: body.poNumber || null,
    docDate: body.docDate ? new Date(body.docDate) : null,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    amount,
    currency,
    amountPhp: await toPhp(amount, currency),
    vatableAmount,
    vatAmount,
    atcCode: body.atcCode || null,
    ewtRate: (body.ewtRate === '' || body.ewtRate == null) ? null : Number(body.ewtRate),
    ewtBase: (body.ewtBase === '' || body.ewtBase == null) ? null : Number(body.ewtBase),
    ewtAmount: (body.ewtAmount === '' || body.ewtAmount == null) ? null : Number(body.ewtAmount),
    category: body.category || null,
    frequency: body.frequency || null,
    notes: body.notes || null,
    remarks: body.remarks || null,
    assignedToId: body.assignedToId || null,
    status,
    paidAt: status === 'PAID' ? (body.paidAt ? new Date(body.paidAt) : new Date()) : null,
    receiptId: body.receiptId || null,
  };
}

router.post('/', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const data = await buildData(req.body);
    data.createdById = req.user.id;
    data.lastEditedById = req.user.id;
    const doc = await prisma.ledgerDoc.create({ data, include });
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk-create several docs at once (used after bulk OCR upload). Body: { docs: [...] }
router.post('/bulk', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { docs } = req.body;
    if (!Array.isArray(docs) || docs.length === 0) return res.status(400).json({ error: 'No documents provided' });
    const created = [];
    for (const d of docs) {
      const data = await buildData(d);
      data.createdById = req.user.id;
      data.lastEditedById = req.user.id;
      created.push(await prisma.ledgerDoc.create({ data }));
    }
    res.status(201).json({ created: created.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const existing = await prisma.ledgerDoc.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const amount = b.amount !== undefined ? Number(b.amount) : existing.amount;
    const currency = b.currency || existing.currency;
    const { vatableAmount, vatAmount } = fillVat(amount, b.vatableAmount, b.vatAmount);
    const statusUp = b.status !== undefined ? normStatus(b.status) : existing.status;
    const doc = await prisma.ledgerDoc.update({
      where: { id: req.params.id },
      data: {
        docType: b.docType !== undefined ? normalizeType(b.docType) : undefined,
        clientId: b.clientId !== undefined ? (b.clientId || null) : undefined,
        vendorName: b.vendorName !== undefined ? (b.vendorName || null) : undefined,
        vendorTin: b.vendorTin !== undefined ? (b.vendorTin || null) : undefined,
        businessStyle: b.businessStyle !== undefined ? (b.businessStyle || null) : undefined,
        docNumber: b.docNumber !== undefined ? (b.docNumber || null) : undefined,
        poNumber: b.poNumber !== undefined ? (b.poNumber || null) : undefined,
        docDate: b.docDate !== undefined ? (b.docDate ? new Date(b.docDate) : null) : undefined,
        dueDate: b.dueDate !== undefined ? (b.dueDate ? new Date(b.dueDate) : null) : undefined,
        amount: b.amount !== undefined ? amount : undefined,
        currency: b.currency !== undefined ? currency : undefined,
        amountPhp: (b.amount !== undefined || b.currency !== undefined) ? await toPhp(amount, currency) : undefined,
        vatableAmount: (b.amount !== undefined || b.vatableAmount !== undefined) ? vatableAmount : undefined,
        vatAmount: (b.amount !== undefined || b.vatAmount !== undefined) ? vatAmount : undefined,
        atcCode: b.atcCode !== undefined ? (b.atcCode || null) : undefined,
        ewtRate: b.ewtRate !== undefined ? ((b.ewtRate === '' || b.ewtRate == null) ? null : Number(b.ewtRate)) : undefined,
        ewtBase: b.ewtBase !== undefined ? ((b.ewtBase === '' || b.ewtBase == null) ? null : Number(b.ewtBase)) : undefined,
        ewtAmount: b.ewtAmount !== undefined ? ((b.ewtAmount === '' || b.ewtAmount == null) ? null : Number(b.ewtAmount)) : undefined,
        category: b.category !== undefined ? (b.category || null) : undefined,
        frequency: b.frequency !== undefined ? (b.frequency || null) : undefined,
        notes: b.notes !== undefined ? (b.notes || null) : undefined,
        remarks: b.remarks !== undefined ? (b.remarks || null) : undefined,
        assignedToId: b.assignedToId !== undefined ? (b.assignedToId || null) : undefined,
        archived: b.archived !== undefined ? !!b.archived : undefined,
        status: b.status !== undefined ? statusUp : undefined,
        paidAt: b.status !== undefined ? (statusUp === 'PAID' ? (existing.paidAt || new Date()) : null) : undefined,
        receiptId: b.receiptId !== undefined ? (b.receiptId || null) : undefined,
        lastEditedById: req.user.id,
      },
      include,
    });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Multi-select bulk operations on selected document ids.
// body: { ids:[], action:'paid'|'unpaid'|'archive'|'unarchive'|'assign'|'delete', assignedToId? }
router.post('/bulk-action', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { ids, action, assignedToId, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No rows selected' });
    const where = { id: { in: ids } };
    let data;
    switch (action) {
      case 'status': {
        const s = normStatus(status);
        data = { status: s, paidAt: s === 'PAID' ? new Date() : null };
        break;
      }
      case 'archive': data = { archived: true }; break;
      case 'unarchive': data = { archived: false }; break;
      case 'assign': data = { assignedToId: assignedToId || null }; break;
      case 'delete':
        await prisma.ledgerDoc.deleteMany({ where });
        return res.json({ deleted: ids.length });
      default: return res.status(400).json({ error: 'Unknown action' });
    }
    data.lastEditedById = req.user.id;
    const r = await prisma.ledgerDoc.updateMany({ where, data });
    res.json({ updated: r.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Single-document status change.
router.post('/:id/status', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const s = normStatus(req.body?.status);
    const doc = await prisma.ledgerDoc.update({
      where: { id: req.params.id },
      data: { status: s, paidAt: s === 'PAID' ? new Date() : null, lastEditedById: req.user.id },
      include,
    });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/mark-paid', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const when = req.body?.paidAt ? new Date(req.body.paidAt) : new Date();
    const doc = await prisma.ledgerDoc.update({ where: { id: req.params.id }, data: { status: 'PAID', paidAt: when, lastEditedById: req.user.id }, include });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/mark-unpaid', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const doc = await prisma.ledgerDoc.update({ where: { id: req.params.id }, data: { status: 'FOR_APPROVAL', paidAt: null, lastEditedById: req.user.id }, include });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    await prisma.ledgerDoc.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Submit an AP/AR document for approval — builds the approval chain from the
// document CREATOR's approval flow (same engine as expenses).
router.post('/:id/submit', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const doc = await prisma.ledgerDoc.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (['PENDING', 'APPROVED', 'PROCESSED', 'PAID'].includes(doc.status)) return res.status(400).json({ error: 'Already submitted or processed' });

    // The chain follows the creator's approval flow (fallback to the submitter).
    const creatorId = doc.createdById || req.user.id;
    const creator = await prisma.user.findUnique({ where: { id: creatorId } });
    const steps = getFlowSteps(creator || req.user);

    // No approvers -> auto-approve.
    if (steps.length === 0) {
      await prisma.$transaction([
        prisma.approval.deleteMany({ where: { ledgerDocId: doc.id } }),
        prisma.ledgerDoc.update({ where: { id: doc.id }, data: { status: 'APPROVED', lastEditedById: req.user.id } }),
      ]);
      return res.json({ message: 'Submitted', doc: await prisma.ledgerDoc.findUnique({ where: { id: doc.id }, include }) });
    }

    const mode = (creator && creator.approvalMode) || 'SEQUENTIAL';
    const rows = buildRowsFromSteps(doc.id, steps);
    await prisma.$transaction([
      prisma.approval.deleteMany({ where: { ledgerDocId: doc.id } }),
      prisma.ledgerDoc.update({ where: { id: doc.id }, data: { status: 'PENDING', lastEditedById: req.user.id } }),
      ...rows.map(r => prisma.approval.create({ data: {
        ledgerDocId: doc.id, approverId: r.approverId, level: r.stepOrder,
        stepOrder: r.stepOrder, groupKey: r.groupKey, stepRule: r.stepRule, status: 'PENDING',
      } })),
    ]);

    // Notify the currently-actionable approvers — in-app + email (mirrors expenses).
    const notify = mode === 'ANY_ORDER' ? rows : rows.filter(r => r.stepOrder === 1);
    const label = `${doc.vendorName || 'AP/AR document'}${doc.docNumber ? ` (${doc.docNumber})` : ''}`;
    const pseudo = ledgerAsExpense(doc, creator);
    for (const approverId of [...new Set(notify.map(r => r.approverId))]) {
      await createNotification(approverId, 'APPROVAL_REQUEST', 'New AP/AR invoice to approve',
        `An AP/AR invoice "${label}" needs your approval`, '/approvals').catch(() => {});
      const apu = await prisma.user.findUnique({ where: { id: approverId } }).catch(() => null);
      if (apu?.email) await sendApprovalRequestEmail(apu.email, nm(apu), pseudo, creator, 'apar').catch(() => {});
    }
    res.json({ message: 'Submitted', doc: await prisma.ledgerDoc.findUnique({ where: { id: doc.id }, include }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk mark AP/AR invoices processed (paid out) — mirrors expense payouts.
router.post('/bulk-mark-processed', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { ids, payoutDate } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No invoices selected' });
    const when = payoutDate ? new Date(payoutDate) : new Date();
    const rows = await prisma.ledgerDoc.findMany({ where: { id: { in: ids } } });
    const eligible = rows.filter(d => d.status === 'APPROVED' && !d.processedAt);
    let count = 0;
    for (const d of eligible) {
      await prisma.ledgerDoc.update({ where: { id: d.id }, data: { status: 'PROCESSED', processedAt: when, payoutDate: when, paidAt: when } });
      count++;
      // Email the creator that their AP/AR invoice was processed (paid out) — mirrors expenses.
      const creator = d.createdById ? await prisma.user.findUnique({ where: { id: d.createdById } }).catch(() => null) : null;
      if (creator?.email) {
        const pseudo = ledgerAsExpense({ ...d, status: 'PROCESSED', processedAt: when, payoutDate: when }, creator);
        await sendStatusUpdateEmail(creator.email, nm(creator), pseudo, 'PROCESSED', creator, 'apar').catch(() => {});
      }
    }
    await logAudit(req.user, 'LEDGER_BULK_PROCESSED', { targetType: 'LEDGER_DOC', details: `Marked ${count} AP/AR invoice(s) processed` });
    res.json({ message: `Marked ${count} invoice(s) processed`, count, skipped: ids.length - count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Undo a processed AP/AR payout (revert to APPROVED).
router.post('/:id/unmark-processed', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const d = await prisma.ledgerDoc.findUnique({ where: { id: req.params.id } });
    if (!d) return res.status(404).json({ error: 'Not found' });
    if (d.status !== 'PROCESSED') return res.status(400).json({ error: 'Not a processed invoice' });
    await prisma.ledgerDoc.update({ where: { id: req.params.id }, data: { status: 'APPROVED', processedAt: null, payoutDate: null, paidAt: null } });
    // Notify creator the payout was reverted (mirrors expense reprocessing email).
    const creator = d.createdById ? await prisma.user.findUnique({ where: { id: d.createdById } }).catch(() => null) : null;
    if (creator?.email) await sendStatusUpdateEmail(creator.email, nm(creator), ledgerAsExpense(d, creator), 'REPROCESSING', creator, 'apar').catch(() => {});
    await logAudit(req.user, 'LEDGER_PAYOUT_REVERSED', { targetType: 'LEDGER_DOC', targetId: req.params.id, details: `Reversed payout for "${d.vendorName || 'AP/AR document'}${d.docNumber ? ` (${d.docNumber})` : ''}"` });
    res.json({ message: 'Unmarked' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /ledger/export — Excel download of AP/AR invoices

// Bulk delete AP/AR invoices (Admin only) — clears approvals first to satisfy FKs.
router.post('/delete-selected', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No invoices selected' });
    await prisma.approval.deleteMany({ where: { ledgerDocId: { in: ids } } });
    const r = await prisma.ledgerDoc.deleteMany({ where: { id: { in: ids } } });
    await logAudit(req.user, 'LEDGER_BULK_DELETED', { targetType: 'LEDGER_DOC', details: `Deleted ${r.count} AP/AR invoice(s)` });
    res.json({ message: `Deleted ${r.count} invoice(s)`, deleted: r.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
