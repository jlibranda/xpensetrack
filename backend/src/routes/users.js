// src/routes/users.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', authenticate, requireRole('ADMIN', 'MANAGER', 'FINANCE'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, department: true, managerId: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

router.patch('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { role, department, managerId } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role, department, managerId },
    select: { id: true, name: true, email: true, role: true, department: true },
  });
  res.json(user);
});

module.exports = router;
