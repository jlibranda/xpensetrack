// src/routes/receipts.js
// Admin tools to (1) download all receipt images as a ZIP and (2) purge receipt
// image bytes to free database space. Both gated by `manage_receipt_storage`.
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requirePermission } = require('../middleware/auth');
const prisma = new PrismaClient();

function sanitize(s) {
  return String(s == null ? '' : s).trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}
function ymd(d) { try { return new Date(d).toISOString().split('T')[0]; } catch { return 'na'; } }
function extFor(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

// Build the requested filename: FullName_DateSubmitted_Status_StatusDate
function buildName(meta, idx) {
  const exp = (meta.expenses && meta.expenses[0]) || null;
  const sub = exp?.submittedBy;
  const fullName = sub ? `${sub.firstName || ''} ${sub.lastName || ''}`.trim() : 'unknown';
  const submitted = exp?.createdAt ? ymd(exp.createdAt) : 'na';
  const status = exp?.status || 'na';
  const statusDate = exp?.status === 'PROCESSED' && exp?.processedAt ? ymd(exp.processedAt)
    : exp?.updatedAt ? ymd(exp.updatedAt) : 'na';
  return `${sanitize(fullName)}_${submitted}_${sanitize(status)}_${statusDate}_${idx}.${extFor(meta.mimeType)}`;
}

const metaSelect = {
  id: true, mimeType: true, storageKey: true,
  expenses: { select: {
    createdAt: true, status: true, processedAt: true, updatedAt: true,
    submittedBy: { select: { firstName: true, lastName: true } },
  } },
};

// GET /api/receipts/archive — stream a ZIP of every receipt image.
router.get('/archive', authenticate, requirePermission('manage_receipt_storage'), async (req, res) => {
  try {
    const archiver = require('archiver');
    const storage = require('../lib/storage');
    const metas = await prisma.receipt.findMany({ select: metaSelect, orderBy: { createdAt: 'asc' } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="receipts-${ymd(Date.now())}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => { try { if (!res.headersSent) res.status(500).end(); } catch (e) {} });
    archive.pipe(res);

    let idx = 0;
    for (const meta of metas) {
      idx++;
      let buf = null;
      try {
        if (meta.storageKey) buf = (await storage.getObject(meta.storageKey)).buffer;
        else {
          const full = await prisma.receipt.findUnique({ where: { id: meta.id }, select: { data: true } });
          if (full?.data) buf = Buffer.from(full.data);
        }
      } catch (e) { /* skip unreadable */ }
      if (buf) archive.append(buf, { name: buildName(meta, idx) });
    }
    await archive.finalize();
  } catch (err) {
    console.error('receipt archive error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/receipts/storage-stats — quick count + approx size (best-effort).
router.get('/storage-stats', authenticate, requirePermission('manage_receipt_storage'), async (req, res) => {
  try {
    const total = await prisma.receipt.count();
    const withBytes = await prisma.receipt.count({ where: { NOT: { data: null } } });
    const inStorage = await prisma.receipt.count({ where: { NOT: { storageKey: null } } });
    const orphans = await prisma.receipt.count({ where: { expenses: { none: {} }, ledgerDocs: { none: {} } } });
    res.json({ total, withBytes, inStorage, orphans });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/receipts/purge — remove receipt image bytes to free space.
// Keeps the receipt record + metadata (expense links stay intact); only the
// heavy image bytes (DB blob and/or object-storage file) are removed.
// Body: { confirm: 'PURGE', status?: 'PROCESSED', olderThan?: 'YYYY-MM-DD' }
router.post('/purge', authenticate, requirePermission('manage_receipt_storage'), async (req, res) => {
  try {
    const { confirm, status, olderThan } = req.body || {};
    if (confirm !== 'PURGE') return res.status(400).json({ error: "Type PURGE to confirm." });
    const storage = require('../lib/storage');
    const metas = await prisma.receipt.findMany({
      select: { id: true, storageKey: true, data: false, expenses: { select: { status: true, createdAt: true } } },
    });
    let count = 0;
    for (const m of metas) {
      const exp = (m.expenses && m.expenses[0]) || null;
      if (status && (!exp || exp.status !== status)) continue;
      if (olderThan && (!exp || new Date(exp.createdAt) >= new Date(olderThan))) continue;
      if (m.storageKey) { await storage.deleteObject(m.storageKey).catch(() => {}); }
      try {
        await prisma.receipt.update({ where: { id: m.id }, data: { data: null, storageKey: null } });
        count++;
      } catch (e) { /* a single failure shouldn't stop the batch */ }
    }
    res.json({
      message: `Removed image data for ${count} receipt(s). To reclaim disk space on PostgreSQL, run VACUUM (FULL) — ask if you need help.`,
      count,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/receipts/:id — delete a single receipt, but ONLY if it's an orphan
// (not attached to any expense or ledger doc). Used by the "Remove" button so a
// just-uploaded image that the user removes doesn't linger in storage. Safe for
// any authenticated user since orphans belong to no one.
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const r = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      select: { id: true, storageKey: true, expenses: { select: { id: true } }, ledgerDocs: { select: { id: true } } },
    });
    if (!r) return res.json({ deleted: false, reason: 'not_found' });
    if ((r.expenses?.length || 0) > 0 || (r.ledgerDocs?.length || 0) > 0) {
      return res.status(409).json({ deleted: false, reason: 'linked' });
    }
    if (r.storageKey) { try { require('../lib/storage').deleteObject(r.storageKey); } catch (e) {} }
    await prisma.receipt.delete({ where: { id: r.id } });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/receipts/purge-orphans — delete ALL orphan receipts (uploads never
// attached to an expense). Fully removes the row + bytes + object. Permission-gated.
router.post('/purge-orphans', authenticate, requirePermission('manage_receipt_storage'), async (req, res) => {
  try {
    const storage = require('../lib/storage');
    const orphans = await prisma.receipt.findMany({
      where: { expenses: { none: {} }, ledgerDocs: { none: {} } },
      select: { id: true, storageKey: true },
    });
    let count = 0;
    for (const r of orphans) {
      if (r.storageKey) await storage.deleteObject(r.storageKey).catch(() => {});
      try { await prisma.receipt.delete({ where: { id: r.id } }); count++; } catch (e) { /* skip */ }
    }
    res.json({ message: `Deleted ${count} orphan receipt(s) (uploads not attached to any expense).`, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;