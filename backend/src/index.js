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
  ['notifications', '/api/notifications'],
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
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
