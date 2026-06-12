// src/lib/audit.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Record an audit entry. `actor` is the req.user object (may be undefined).
// Never throws — auditing must not break the underlying action.
async function logAudit(actor, action, { targetType, targetId, details } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id || null,
        actorName: actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.email || 'Unknown' : 'System',
        actorRole: actor?.role || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        details: details || null,
      },
    });
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

module.exports = { logAudit };
