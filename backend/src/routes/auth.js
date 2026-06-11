// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const prisma = new PrismaClient();

// POST /api/auth/register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().notEmpty(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, name, password, department, role } = req.body;
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, department, role: role || 'EMPLOYEE' },
      select: { id:true, email:true, name:true, role:true, department:true },
    });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, token });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const { passwordHash, ...safe } = req.user;
  res.json(safe);
});

// PATCH /api/auth/change-password
router.patch('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ message: 'Password changed successfully' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    // Delete old tokens
    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt } });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    // Send email if configured
    const { sendPasswordResetEmail } = require('../lib/email');
    await sendPasswordResetEmail(user.email, user.name, resetUrl).catch(() => {});

    // In development, return the token directly
    const isDev = process.env.NODE_ENV !== 'production';
    res.json({
      message: 'If that email exists, a reset link has been sent.',
      ...(isDev && { resetUrl, note: 'Dev mode: reset URL included in response' }),
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const reset = await prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!reset || reset.used || reset.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
    ]);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
