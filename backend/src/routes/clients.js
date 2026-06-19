// src/routes/clients.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requirePermission } = require('../middleware/auth');
const prisma = new PrismaClient();

const PERM = 'manage_ap_ar';
const FALLBACK = ['FINANCE', 'ADMIN'];

// List clients with a count of their documents and last activity.
router.get('/', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { docs: true } } },
    });
    // Last activity per client (most recent doc date or createdAt).
    const withActivity = await Promise.all(clients.map(async (c) => {
      const last = await prisma.ledgerDoc.findFirst({
        where: { clientId: c.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, docDate: true },
      });
      return {
        id: c.id,
        name: c.name,
        isDefault: c.isDefault,
        docCount: c._count.docs,
        lastActivity: last?.docDate || last?.createdAt || null,
      };
    }));
    res.json(withActivity);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { name, isDefault } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Client name required' });
    if (isDefault) await prisma.client.updateMany({ data: { isDefault: false } });
    const c = await prisma.client.create({ data: { name: name.trim(), isDefault: !!isDefault } });
    res.status(201).json(c);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const { name, isDefault } = req.body;
    if (isDefault) await prisma.client.updateMany({ data: { isDefault: false } });
    const c = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        isDefault: isDefault !== undefined ? !!isDefault : undefined,
      },
    });
    res.json(c);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requirePermission(PERM, FALLBACK), async (req, res) => {
  try {
    const count = await prisma.ledgerDoc.count({ where: { clientId: req.params.id } });
    if (count > 0) {
      // Don't orphan documents silently — detach them first.
      await prisma.ledgerDoc.updateMany({ where: { clientId: req.params.id }, data: { clientId: null } });
    }
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted', detached: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
