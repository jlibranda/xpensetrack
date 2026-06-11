// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const prisma = new PrismaClient();

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

router.get('/me', authenticate, (req, res) => {
  const { passwordHash, ...safe } = req.user;
  res.json(safe);
});

router.patch('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
    res.json({ message: 'Password changed successfully' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.', emailSent: false });

    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt } });

    const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    // Try to send email
    const { sendPasswordResetEmail } = require('../lib/email');
    let emailSent = false;
    try {
      await sendPasswordResetEmail(user.email, user.name, resetUrl);
      emailSent = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
    } catch(e) { emailSent = false; }

    // Always return resetUrl so admin can share it manually if email not configured
    res.json({
      message: emailSent
        ? 'Password reset link sent to your email.'
        : 'Email not configured. Copy the reset link below and share it with the user.',
      emailSent,
      resetUrl, // always include so admin can copy/share it
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  try {
    const reset = await prisma.passwordReset.findUnique({ where: { token }, include: { user: true } });
    if (!reset || reset.used || reset.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
    ]);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
