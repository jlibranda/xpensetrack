// src/routes/chains.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

const chainInclude = {
  steps: {
    orderBy: { order: 'asc' },
    include: {
      approvers: {
        include: { approver: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      },
    },
  },
  _count: { select: { assignees: true } },
};

// Validate a steps payload: array of { approverIds: [ids] }, 1..5 steps, each step >=1 approver
function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 1) return 'At least 1 approval step is required';
  if (steps.length > 5) return 'Maximum of 5 approval steps allowed';
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || !Array.isArray(s.approverIds) || s.approverIds.length < 1) {
      return `Step ${i + 1} must have at least one approver`;
    }
  }
  return null;
}

// GET all chains
router.get('/', authenticate, requireRole('ADMIN', 'FINANCE', 'MANAGER'), async (req, res) => {
  try {
    const chains = await prisma.approvalChain.findMany({ include: chainInclude, orderBy: { name: 'asc' } });
    res.json(chains);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single chain
router.get('/:id', authenticate, requireRole('ADMIN', 'FINANCE', 'MANAGER'), async (req, res) => {
  try {
    const chain = await prisma.approvalChain.findUnique({ where: { id: req.params.id }, include: chainInclude });
    if (!chain) return res.status(404).json({ error: 'Not found' });
    res.json(chain);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: create a chain with its steps + approver options in one transaction
async function createChainWithSteps({ name, mode, steps }) {
  return prisma.$transaction(async (tx) => {
    const chain = await tx.approvalChain.create({
      data: { name: name.trim(), mode: mode === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL' },
    });
    for (let i = 0; i < steps.length; i++) {
      const step = await tx.approvalStep.create({ data: { chainId: chain.id, order: i + 1 } });
      // de-dupe approver ids within a step
      const ids = [...new Set(steps[i].approverIds.filter(Boolean))];
      for (const approverId of ids) {
        await tx.approvalStepApprover.create({ data: { stepId: step.id, approverId } });
      }
    }
    return chain.id;
  });
}

// POST create chain  { name, mode, steps:[{approverIds:[]}] }
router.post('/', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, mode, steps } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Chain name is required' });
    const err = validateSteps(steps);
    if (err) return res.status(400).json({ error: err });

    const existing = await prisma.approvalChain.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(400).json({ error: 'A chain with that name already exists' });

    const id = await createChainWithSteps({ name, mode, steps });
    const chain = await prisma.approvalChain.findUnique({ where: { id }, include: chainInclude });
    res.status(201).json(chain);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH update chain (replaces steps wholesale)  { name?, mode?, steps? }
router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, mode, steps } = req.body;
    const chain = await prisma.approvalChain.findUnique({ where: { id: req.params.id } });
    if (!chain) return res.status(404).json({ error: 'Not found' });

    if (steps !== undefined) {
      const err = validateSteps(steps);
      if (err) return res.status(400).json({ error: err });
    }
    if (name && name.trim() !== chain.name) {
      const dupe = await prisma.approvalChain.findUnique({ where: { name: name.trim() } });
      if (dupe) return res.status(400).json({ error: 'A chain with that name already exists' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalChain.update({
        where: { id: chain.id },
        data: {
          name: name ? name.trim() : undefined,
          mode: mode ? (mode === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL') : undefined,
        },
      });
      if (steps !== undefined) {
        // delete existing steps (cascade removes approver options), then recreate
        await tx.approvalStep.deleteMany({ where: { chainId: chain.id } });
        for (let i = 0; i < steps.length; i++) {
          const step = await tx.approvalStep.create({ data: { chainId: chain.id, order: i + 1 } });
          const ids = [...new Set(steps[i].approverIds.filter(Boolean))];
          for (const approverId of ids) {
            await tx.approvalStepApprover.create({ data: { stepId: step.id, approverId } });
          }
        }
      }
    });

    const updated = await prisma.approvalChain.findUnique({ where: { id: chain.id }, include: chainInclude });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE chain (only if not assigned to anyone)
router.delete('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const count = await prisma.user.count({ where: { approvalChainId: req.params.id } });
    if (count > 0) return res.status(400).json({ error: `Cannot delete: chain is assigned to ${count} user(s). Reassign them first.` });
    await prisma.approvalStep.deleteMany({ where: { chainId: req.params.id } });
    await prisma.approvalChain.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST assign a chain to users  { chainId, userIds:[] }
router.post('/assign', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { chainId, userIds } = req.body;
    if (!chainId || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'chainId and userIds are required' });
    }
    const chain = await prisma.approvalChain.findUnique({ where: { id: chainId } });
    if (!chain) return res.status(404).json({ error: 'Chain not found' });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { approvalChainId: chainId } });
    res.json({ message: `Assigned chain to ${userIds.length} user(s)` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST bulk upload chains.
// Accepts { chains: [ { name, mode, steps:[{approverEmails:[]}] OR steps:[{approverIds:[]}] } ] }
// Resolves approver emails -> ids when emails are provided (friendlier for CSV).
router.post('/bulk', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { chains } = req.body;
    if (!Array.isArray(chains) || chains.length === 0) return res.status(400).json({ error: 'chains array required' });

    // Preload all users once for email->id resolution
    const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
    const emailToId = {};
    for (const u of allUsers) emailToId[u.email.toLowerCase()] = u.id;

    const results = { created: [], skipped: [], errors: [] };

    for (const ch of chains) {
      try {
        if (!ch.name || !ch.name.trim()) { results.errors.push({ name: ch.name || '?', reason: 'Missing chain name' }); continue; }

        const existing = await prisma.approvalChain.findUnique({ where: { name: ch.name.trim() } });
        if (existing) { results.skipped.push({ name: ch.name, reason: 'Already exists' }); continue; }

        // Normalise steps: each step may carry approverIds or approverEmails
        const normSteps = [];
        let stepErr = null;
        for (let i = 0; i < (ch.steps || []).length; i++) {
          const s = ch.steps[i];
          let ids = Array.isArray(s.approverIds) ? [...s.approverIds] : [];
          if (Array.isArray(s.approverEmails)) {
            for (const em of s.approverEmails) {
              const id = emailToId[String(em).toLowerCase().trim()];
              if (!id) { stepErr = `Unknown approver email "${em}" in step ${i + 1}`; break; }
              ids.push(id);
            }
          }
          if (stepErr) break;
          normSteps.push({ approverIds: [...new Set(ids.filter(Boolean))] });
        }
        if (stepErr) { results.errors.push({ name: ch.name, reason: stepErr }); continue; }

        const vErr = validateSteps(normSteps);
        if (vErr) { results.errors.push({ name: ch.name, reason: vErr }); continue; }

        await createChainWithSteps({ name: ch.name, mode: ch.mode, steps: normSteps });
        results.created.push({ name: ch.name, steps: normSteps.length });
      } catch (e) {
        results.errors.push({ name: ch.name || '?', reason: e.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
