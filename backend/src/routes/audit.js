// src/routes/audit.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const prisma = new PrismaClient();

// GET /api/audit — list audit entries (admin only), newest first, with optional filters.
router.get('/', authenticate, requirePermission('view_audit_log', ['ADMIN']), async (req, res) => {
  try {
    const { action, from, to, limit = 200 } = req.query;
    const where = {};
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
    });
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
