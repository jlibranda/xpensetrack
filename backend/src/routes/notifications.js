// src/routes/notifications.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = new PrismaClient();

// Admin-only: send a test email to verify the email provider is configured.
router.post('/test-email', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { sendTestEmail } = require('../lib/email');
    const to = (req.body && req.body.to) || req.user.email;
    const ok = await sendTestEmail(to, `${req.user.firstName || ''}`.trim());
    if (ok) return res.json({ sent: true, to });
    return res.status(400).json({ sent: false, to, error: 'Email not configured or provider rejected the message. Check server logs and RESEND_API_KEY / RESEND_FROM.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unreadCount = notifications.filter(n => !n.read).length;
    res.json({ notifications, unreadCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    res.json({ message: 'All marked as read' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    res.json({ message: 'Marked as read' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
