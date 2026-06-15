// src/routes/ledger.js
// AP/AR documents (payables & receivables). Reuses the Receipt model for the
// attached file and the OCR /scan endpoint for extraction (done client-side).
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requirePermission } = require('../middleware/auth');
const { getUsdPhpRate } = require('../lib/fxrate');
const prisma = new PrismaClient();

const PERM = 'manage_ap_ar';
const FALLBACK = ['FINANCE', 'ADMIN'];
const DOC_TYPES = ['AP_INVOICE', 'AP_RECEIPT', 'AR_INVOICE'];
const STAGES = ['DRAFT', 'FOR_VERIFICATION', 'FOR_APPROVAL', 'PAID'];
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

router.get('/', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { docType, status, clientId, q, from, to, archived, assignedToId } = req.query;
    const where = {};
    where.archived = archived === '1' || archived === 'true';
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

router.get('/summary', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
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
    category: body.category || null,
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
        category: b.category !== undefined ? (b.category || null) : undefined,
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

module.exports = router;
