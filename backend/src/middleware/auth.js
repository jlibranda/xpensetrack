// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Sensible defaults if Access Control hasn't been configured yet.
// Mirrors the frontend DEFAULT_PERMS so behaviour is consistent.
const DEFAULT_PERMS = {
  approve_expenses: ['MANAGER', 'FINANCE', 'ADMIN'],
  view_team_expenses: ['MANAGER', 'FINANCE', 'ADMIN'],
  view_reports: ['MANAGER', 'FINANCE', 'ADMIN'],
  view_analytics: ['FINANCE', 'ADMIN'],
  export_reports: ['MANAGER', 'FINANCE', 'ADMIN'],
  second_approval: ['FINANCE', 'ADMIN'],
  mark_reimbursed: ['FINANCE', 'ADMIN'],
  edit_categories: ['FINANCE', 'ADMIN'],
  manage_settings: ['FINANCE', 'ADMIN'],
  manage_users: ['ADMIN'],
  toggle_access: ['ADMIN'],
  reset_passwords: ['ADMIN'],
  upload_branding: ['ADMIN'],
  change_branding: ['ADMIN'],
  impersonate_user: ['ADMIN'],
};

const authenticate = async (req, res, next) => {
  // Accept token from header OR query param (needed for file downloads)
  const header = req.headers.authorization;
  const token = (header && header.startsWith('Bearer ') ? header.split(' ')[1] : null)
    || req.query.token;

  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    if (!req.user.isActive) return res.status(401).json({ error: 'Account deactivated' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Hard role gate (kept for routes that should never be configurable).
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// Permission gate driven by Access Control settings.
// ADMIN always passes. Otherwise we read the saved accessControl map;
// if the permission isn't configured, we fall back to DEFAULT_PERMS,
// and if that's also missing, to the provided fallbackRoles (default ADMIN).
const requirePermission = (permKey, fallbackRoles = ['ADMIN']) => async (req, res, next) => {
  try {
    if (req.user.role === 'ADMIN') return next(); // ADMIN always allowed

    let allowed = null;
    const settings = await prisma.orgSettings.findFirst();
    if (settings && settings.accessControlJson) {
      try {
        const ac = JSON.parse(settings.accessControlJson);
        if (ac && Array.isArray(ac[permKey])) allowed = ac[permKey];
      } catch (e) { /* fall through to defaults */ }
    }
    if (!allowed) allowed = DEFAULT_PERMS[permKey] || fallbackRoles;

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { authenticate, requireRole, requirePermission };
