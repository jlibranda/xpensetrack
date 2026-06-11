// src/routes/users.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', authenticate, requireRole('ADMIN','MANAGER','FINANCE'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id:true, name:true, email:true, role:true, department:true, costCenter:true, managerId:true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { role, department, managerId, costCenter } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role, department, managerId: managerId||null, costCenter: costCenter||null },
      select: { id:true, name:true, email:true, role:true, department:true, costCenter:true, managerId:true },
    });
    res.json(user);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) return res.status(400).json({ error: 'users array required' });
  const results = { created: [], skipped: [], errors: [] };
  for (const u of users) {
    if (!u.name || !u.email || !u.password) { results.errors.push({ email: u.email, reason: 'Missing name, email or password' }); continue; }
    try {
      const existing = await prisma.user.findUnique({ where: { email: u.email.toLowerCase().trim() } });
      if (existing) { results.skipped.push({ email: u.email, reason: 'Already exists' }); continue; }
      const passwordHash = await bcrypt.hash(u.password, 12);
      const created = await prisma.user.create({
        data: { name:u.name.trim(), email:u.email.toLowerCase().trim(), passwordHash,
          role: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(u.role?.toUpperCase()) ? u.role.toUpperCase() : 'EMPLOYEE',
          department: u.department?.trim()||null, costCenter: u.costCenter?.trim()||null },
        select: { id:true, name:true, email:true, role:true },
      });
      results.created.push(created);
      const { sendWelcomeEmail } = require('../lib/email');
      await sendWelcomeEmail(created.email, created.name, u.password).catch(()=>{});
    } catch(err) { results.errors.push({ email: u.email, reason: err.message }); }
  }
  res.json(results);
});

module.exports = router;
