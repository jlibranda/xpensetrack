// src/lib/receiptCleanup.js
// Deletes Receipt rows AND their storage objects (Vercel Blob / S3) so that
// deleting an expense or AP/AR document never leaves orphan files behind.
// Best-effort by design: a failed storage delete must never block the main
// delete — an orphaned object is only wasted space, not a correctness bug.
const { PrismaClient } = require('@prisma/client');
const storage = require('./storage');
const prisma = new PrismaClient();

// Delete the given Receipt ids (nulls/dupes are fine).
async function deleteReceiptsByIds(receiptIds) {
  const ids = [...new Set((receiptIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  try {
    const receipts = await prisma.receipt.findMany({ where: { id: { in: ids } }, select: { id: true, storageKey: true } });
    for (const r of receipts) {
      if (r.storageKey && storage.storageConfigured()) {
        try { await storage.deleteObject(r.storageKey); } catch (e) { console.error('Receipt object delete failed:', e.message); }
      }
    }
    const del = await prisma.receipt.deleteMany({ where: { id: { in: ids } } });
    return del.count;
  } catch (e) {
    console.error('Receipt cleanup failed:', e.message);
    return 0;
  }
}

// Collect receipt + proof-of-payment ids from expenses (call BEFORE deleting them).
async function receiptIdsForExpenses(expenseIds) {
  if (!expenseIds?.length) return [];
  const rows = await prisma.expense.findMany({ where: { id: { in: expenseIds } }, select: { receiptId: true, proofOfPaymentId: true } });
  return rows.flatMap(r => [r.receiptId, r.proofOfPaymentId]);
}

// Same for AP/AR ledger docs.
async function receiptIdsForLedgerDocs(ledgerIds) {
  if (!ledgerIds?.length) return [];
  const rows = await prisma.ledgerDoc.findMany({ where: { id: { in: ledgerIds } }, select: { receiptId: true, proofOfPaymentId: true } });
  return rows.flatMap(r => [r.receiptId, r.proofOfPaymentId]);
}

module.exports = { deleteReceiptsByIds, receiptIdsForExpenses, receiptIdsForLedgerDocs };
