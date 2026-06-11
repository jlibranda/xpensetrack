require('dotenv').config();
const express = require('express');
const cors = require('cors');

console.log('Loading routes...');

let authRoutes, expenseRoutes, approvalRoutes, reportRoutes, userRoutes, settingsRoutes, ocrRoutes, notificationRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✓ auth');
  expenseRoutes = require('./routes/expenses');
  console.log('✓ expenses');
  approvalRoutes = require('./routes/approvals');
  console.log('✓ approvals');
  reportRoutes = require('./routes/reports');
  console.log('✓ reports');
  userRoutes = require('./routes/users');
  console.log('✓ users');
  settingsRoutes = require('./routes/settings');
  console.log('✓ settings');
  ocrRoutes = require('./routes/ocr');
  console.log('✓ ocr');
  notificationRoutes = require('./routes/notifications');
  console.log('✓ notifications');
} catch(err) {
  console.error('FATAL: Failed to load route:', err.message);
  console.error(err.stack);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.0.0' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => console.log(`XpenseTrack API v4 running on port ${PORT}`));
