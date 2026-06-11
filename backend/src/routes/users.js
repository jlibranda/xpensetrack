// src/routes/users.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

// GET all users
router.get('/', authenticate, requireRole('ADMIN', 'MANAGER', 'FINANCE'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, department: true, managerId: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// PATCH update user role/department/manager
router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { role, department, managerId } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role, department, managerId: managerId || null },
    select: { id: true, name: true, email: true, role: true, department: true, managerId: true },
  });
  res.json(user);
});

// POST /api/users/bulk — bulk create users from CSV/array
router.post('/bulk', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: 'users array is required' });
  }

  const results = { created: [], skipped: [], errors: [] };

  for (const u of users) {
    if (!u.name || !u.email || !u.password) {
      results.errors.push({ email: u.email, reason: 'Missing name, email or password' });
      continue;
    }
    try {
      const existing = await prisma.user.findUnique({ where: { email: u.email.toLowerCase().trim() } });
      if (existing) {
        results.skipped.push({ email: u.email, reason: 'Email already exists' });
        continue;
      }
      const passwordHash = await bcrypt.hash(u.password, 12);
      const created = await prisma.user.create({
        data: {
          name: u.name.trim(),
          email: u.email.toLowerCase().trim(),
          passwordHash,
          role: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(u.role?.toUpperCase())
            ? u.role.toUpperCase() : 'EMPLOYEE',
          department: u.department?.trim() || null,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      results.created.push(created);
    } catch (err) {
      results.errors.push({ email: u.email, reason: err.message });
    }
  }

  res.json(results);
});

module.exports = router;
