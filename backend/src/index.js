process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');

console.log('Starting XpenseTrack API...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT || 3001);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.0.0' }));

// Load routes one by one with error catching
const routes = [
  ['auth', '/api/auth'],
  ['expenses', '/api/expenses'],
  ['approvals', '/api/approvals'],
  ['reports', '/api/reports'],
  ['users', '/api/users'],
  ['settings', '/api/settings'],
  ['ocr', '/api/ocr'],
  ['clients', '/api/clients'],
  ['ledger', '/api/ledger'],
  ['notifications', '/api/notifications'],
  ['audit', '/api/audit'],
];

for (const [name, path] of routes) {
  try {
    const route = require(`./routes/${name}`);
    app.use(path, route);
    console.log(`✓ Loaded route: ${name}`);
  } catch(err) {
    console.error(`✗ Failed to load route ${name}:`, err.message);
    process.exit(1);
  }
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`XpenseTrack API v4 running on port ${PORT}`);
  // Begin periodic USD->PHP rate refresh (auto mode only).
  try { require('./lib/fxrate').startFxRefresh(); } catch (e) { console.error('fxrate start failed:', e.message); }
  // One-time admin recovery: if BOOTSTRAP_ADMIN_EMAIL is set, ensure those
  // users are ADMIN + active. Use to restore an admin, then remove the env var.
  (async () => {
    const raw = process.env.BOOTSTRAP_ADMIN_EMAIL;
    if (!raw) { console.log('Bootstrap admin: BOOTSTRAP_ADMIN_EMAIL not set, skipping'); return; }
    try {
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      const emails = raw.split(',').map(e => e.trim()).filter(Boolean);
      for (const email of emails) {
        // Match case-insensitively by scanning (avoids relying on provider-specific
        // filter modes). Update by id, which always works.
        const all = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
        const matches = all.filter(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (matches.length === 0) {
          console.log(`Bootstrap admin: NO user found for "${email}". Existing emails: ${all.map(u => u.email).join(', ')}`);
          continue;
        }
        for (const m of matches) {
          await prisma.user.update({ where: { id: m.id }, data: { role: 'ADMIN', isActive: true } });
          console.log(`Bootstrap admin: set ${m.email} (was ${m.role}) -> ADMIN`);
        }
      }
    } catch (e) { console.error('Bootstrap admin FAILED:', e.message, e.stack); }
  })();
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
