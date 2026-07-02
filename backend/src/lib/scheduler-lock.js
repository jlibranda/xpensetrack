// src/lib/scheduler-lock.js
// Ensures a scheduled job runs on exactly ONE backend instance per interval,
// even when multiple replicas are running. Uses an atomic conditional UPDATE on
// a shared row: whoever flips nextRunAt forward wins and runs; everyone else skips.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

// A stable-ish id for this process (for observability only).
const INSTANCE_ID = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || crypto.randomBytes(4).toString('hex');

// Try to claim the right to run `name` now. If claimed, pushes nextRunAt forward
// by intervalMs so no other replica (or later tick) runs it until then.
async function claimDue(name, intervalMs) {
  const now = new Date();
  try {
    // Make sure the row exists (epoch nextRunAt => immediately due on first boot).
    await prisma.schedulerLock.upsert({
      where: { name },
      create: { name, nextRunAt: new Date(0), holder: INSTANCE_ID },
      update: {},
    });
    const res = await prisma.schedulerLock.updateMany({
      where: { name, nextRunAt: { lte: now } },
      data: { nextRunAt: new Date(now.getTime() + intervalMs), holder: INSTANCE_ID },
    });
    return res.count === 1;
  } catch (e) {
    console.error(`[scheduler-lock] claim failed for ${name}:`, e.message);
    return false; // on error, don't run (safer than double-running)
  }
}

// Run `fn` if this instance wins the claim for `name`. Call this on a short
// checking cadence (e.g. every 15–30 min); the DB gate enforces the real interval.
async function runIfDue(name, intervalMs, fn) {
  if (await claimDue(name, intervalMs)) {
    try { await fn(); }
    catch (e) { console.error(`[scheduler] ${name} run failed:`, e.message); }
  }
}

module.exports = { runIfDue, INSTANCE_ID };
