// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requirePermission } = require('../middleware/auth');
const prisma = new PrismaClient();

const safeUser = (u) => {
  const { passwordHash, tempPasswordHash, ...safe } = u;
  safe.name = `${u.firstName} ${u.lastName}`.trim();
  return safe;
};

router.post('/register', authenticate, requirePermission('manage_users'), async (req, res) => {
  const { email, name, firstName, lastName, password, department, role, employeeNumber } = req.body;
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Email and password (min 6) required' });

  let fName = firstName || name?.split(' ')[0] || '';
  let lName = lastName || name?.split(' ').slice(1).join(' ') || '';

  const wantedRole = ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(role?.toUpperCase()) ? role.toUpperCase() : 'EMPLOYEE';
  // Only an admin may create another admin.
  if (wantedRole === 'ADMIN' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only an admin can create an admin account' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { firstName: fName, lastName: lName, email: email.toLowerCase(),
        passwordHash, department, employeeNumber: employeeNumber||null,
        role: wantedRole },
    });
    res.status(201).json({ user: safeUser(user) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.isActive) return res.status(401).json({ error: 'Your account has been deactivated. Contact your admin.' });

    // Lockout settings (org-configurable). maxAttempts <= 0 disables lockout.
    const org = await prisma.orgSettings.findFirst();
    const maxAttempts = org?.loginMaxAttempts ?? 5;
    const lockMinutes = org?.loginLockoutMinutes ?? 15;

    // Currently locked?
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const mins = Math.max(1, Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000));
      return res.status(423).json({ error: `Account locked due to too many failed attempts. Try again in ${mins} minute(s) or contact your Finance Department.` });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      // Friendlier message if they typed a temporary password that was already used to set a new one.
      if (user.tempPasswordHash && !user.mustChangePassword && await bcrypt.compare(password, user.tempPasswordHash)) {
        return res.status(401).json({ error: 'This temporary password has already been used. Please log in with the new password you set.' });
      }
      if (maxAttempts > 0) {
        const attempts = (user.failedLoginAttempts || 0) + 1;
        if (attempts >= maxAttempts) {
          const lockedUntil = new Date(Date.now() + lockMinutes * 60000);
          await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts, lockedUntil } });
          return res.status(423).json({ error: `Too many failed attempts. Your account is locked for ${lockMinutes} minute(s).` });
        }
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts } });
        const left = maxAttempts - attempts;
        return res.status(401).json({ error: `Invalid email or password. ${left} attempt(s) left before your account is locked.` });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Success — clear any failed-attempt state.
    if (user.failedLoginAttempts || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: safeUser(user), token });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', authenticate, (req, res) => {
  res.json(safeUser(req.user));
});

router.patch('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Both passwords required, min 6 chars' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) return res.status(400).json({ error: 'Current password incorrect' });
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
    try {
      const { sendPasswordChangedEmail } = require('../lib/email');
      sendPasswordChangedEmail(user.email, `${user.firstName || ''} ${user.lastName || ''}`.trim()).catch(() => {});
    } catch (e) { /* non-blocking */ }
    res.json({ message: 'Password changed successfully' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  try {
    if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required', exists: false });
    const target = email.trim().toLowerCase();
    const users = await prisma.user.findMany();
    const user = users.find(u => (u.email || '').toLowerCase() === target);
    // NOTE: this intentionally reveals whether an account exists (per product
    // requirement) so users with no account are directed to Finance. This enables
    // email enumeration — acceptable for an internal app, but worth knowing.
    if (!user || user.isActive === false) {
      return res.json({ exists: false, message: 'No account found for that email. Please request an account from your Finance Department.' });
    }
    // Invalidate prior unused tokens, then issue a fresh one and email the link.
    await prisma.passwordReset.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt } });
    const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    try {
      const { sendPasswordResetEmail } = require('../lib/email');
      await sendPasswordResetEmail(user.email, `${user.firstName} ${user.lastName}`.trim(), resetUrl, user);
    } catch (e) { console.error('Password reset email failed:', e.message); }
    return res.json({ exists: true, message: 'A password reset link has been sent to your email.' });
  } catch (err) {
    console.error('forgot-password error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.', exists: false });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Token and new password (min 6) required' });
  try {
    const reset = await prisma.passwordReset.findUnique({ where: { token }, include: { user: true } });
    if (!reset || reset.used || reset.expiresAt < new Date()) return res.status(400).json({ error: 'Reset link is invalid or expired' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12), failedLoginAttempts: 0, lockedUntil: null, mustChangePassword: false } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
    ]);
    try {
      const { sendPasswordChangedEmail } = require('../lib/email');
      sendPasswordChangedEmail(reset.user.email, `${reset.user.firstName || ''} ${reset.user.lastName || ''}`.trim()).catch(() => {});
    } catch (e) { /* non-blocking */ }
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
