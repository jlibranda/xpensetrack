// src/routes/users.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const prisma = new PrismaClient();

const userSelect = {
  id:true, employeeNumber:true, firstName:true, lastName:true,
  email:true, role:true, department:true, costCenter:true,
  position:true, payrollAccount:true, isActive:true, managerId:true,
  approverIds:true, approvalMode:true, approvalRule:true,
};

// GET all users
router.get('/', authenticate, requireRole('ADMIN','MANAGER','FINANCE'), async (req, res) => {
  try {
    // Non-admins must never see ADMIN accounts in the list
    const where = req.user.role === 'ADMIN' ? {} : { role: { not: 'ADMIN' } };
    const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { lastName: 'asc' } });
    res.json(users);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET single user
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && !['ADMIN','MANAGER','FINANCE'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { ...userSelect, manager: { select: { id:true, firstName:true, lastName:true } },
        _count: { select: { expenses: true } } },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    // Non-admins cannot view an ADMIN's profile (unless it's their own record)
    if (user.role === 'ADMIN' && req.user.role !== 'ADMIN' && req.user.id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(user);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PATCH update user
router.patch('/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { role, department, managerId, costCenter, position, payrollAccount, isActive, employeeNumber, firstName, lastName, newPassword,
            approverIds, approvalMode, approvalRule } = req.body;

    // Look up the target so we can apply ADMIN guards
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Not found' });

    // Only an ADMIN may edit an existing ADMIN account
    if (target.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can modify an admin account' });
    }
    // Only an ADMIN may grant the ADMIN role
    if (role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can assign the admin role' });
    }

    const updateData = {
      role, department, managerId: managerId||null, costCenter: costCenter||null,
      position: position||null, payrollAccount: payrollAccount||null, isActive,
      employeeNumber: employeeNumber||null, firstName, lastName,
    };
    if (approverIds !== undefined) {
      const ids = Array.isArray(approverIds)
        ? approverIds
        : String(approverIds||'').split(',').map(s => s.trim()).filter(Boolean);
      // These are the ADDITIONAL approvers (#2..#5). Manager is always #1, so:
      //  - drop self, drop the manager (no duplicate), de-dupe, cap at 4 additional.
      const mgr = managerId !== undefined ? managerId : target.managerId;
      const cleaned = [...new Set(ids)]
        .filter(id => id && id !== req.params.id && id !== mgr)
        .slice(0, 4);
      updateData.approverIds = cleaned.length ? cleaned.join(',') : null;
    }
    if (approvalMode !== undefined) updateData.approvalMode = approvalMode === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL';
    if (approvalRule !== undefined) updateData.approvalRule = approvalRule === 'ANY' ? 'ANY' : 'ALL';
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updateData.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: userSelect,
    });
    res.json(user);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST toggle active status
router.post('/:id/toggle-active', authenticate, requirePermission('toggle_access'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can modify an admin account' });
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: userSelect,
    });
    res.json(updated);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST reset password
router.post('/:id/reset-password', authenticate, requirePermission('reset_passwords'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can reset an admin password' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
    res.json({ message: 'Password reset successfully' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST bulk create
router.post('/bulk', authenticate, requirePermission('manage_users'), async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) return res.status(400).json({ error: 'users array required' });

  // Get default password from settings
  const settings = await prisma.orgSettings.findFirst();
  const defaultPwd = settings?.defaultPassword || 'Welcome123';

  const results = { created: [], skipped: [], errors: [] };
  for (const u of users) {
    if (!u.firstName && !u.name) { results.errors.push({ email: u.email, reason: 'Missing name' }); continue; }
    if (!u.email) { results.errors.push({ email: '?', reason: 'Missing email' }); continue; }

    // Support both "name" (old) and "firstName/lastName" (new)
    let firstName = u.firstName || u.name?.split(' ')[0] || u.name;
    let lastName = u.lastName || (u.name?.split(' ').slice(1).join(' ')) || '';

    try {
      const existing = await prisma.user.findUnique({ where: { email: u.email.toLowerCase().trim() } });
      if (existing) { results.skipped.push({ email: u.email, reason: 'Already exists' }); continue; }
      const password = u.password || defaultPwd;
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await prisma.user.create({
        data: { firstName: firstName.trim(), lastName: lastName.trim(),
          email: u.email.toLowerCase().trim(), passwordHash,
          role: ['EMPLOYEE','MANAGER','FINANCE','ADMIN'].includes(u.role?.toUpperCase()) ? u.role.toUpperCase() : 'EMPLOYEE',
          department: u.department?.trim()||null, costCenter: u.costCenter?.trim()||null,
          employeeNumber: u.employeeNumber?.trim()||null, position: u.position?.trim()||null,
          payrollAccount: u.payrollAccount?.trim()||null },
        select: { id:true, firstName:true, lastName:true, email:true, role:true },
      });
      results.created.push(created);
      const { sendWelcomeEmail } = require('../lib/email');
      await sendWelcomeEmail(created.email, `${created.firstName} ${created.lastName}`, password).catch(()=>{});
    } catch(err) { results.errors.push({ email: u.email, reason: err.message }); }
  }
  res.json(results);
});


// POST /api/users/:id/impersonate — Admin logs in AS another user
router.post('/:id/impersonate', authenticate, requirePermission('impersonate_user'), async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can impersonate an admin' });
    }
    if (!target.isActive) return res.status(400).json({ error: 'Cannot impersonate inactive user' });
    // Issue a token for the target user, but embed the admin's id so we can return
    const token = jwt.sign(
      { userId: target.id, impersonatedBy: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    const { passwordHash, ...safeUser } = target;
    safeUser.name = `${target.firstName} ${target.lastName}`.trim();
    safeUser._impersonating = true;
    safeUser._originalAdminId = req.user.id;
    safeUser._originalAdminName = `${req.user.firstName} ${req.user.lastName}`.trim();
    res.json({ user: safeUser, token });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ===== Bulk upload approver assignments (CSV or Excel) =====
// Keyed by EMPLOYEE NUMBER (not email). Columns (header row, case-insensitive):
//   employee_number       (required) - the employee being configured
//   approver1_number      (optional) - becomes the employee's manager (approver #1)
//   approver2_number .. approver5_number  (optional) - additional approvers (#2..#5)
//   mode                  (optional) - SEQUENTIAL | ANY_ORDER  (default SEQUENTIAL)
//   rule                  (optional) - ALL | ANY               (default ALL)
//
// A single "approvers" column with comma/semicolon-separated employee numbers is also
// accepted as an alternative to approver1..approver5 (first one becomes manager).
router.post('/bulk-approvers', authenticate, requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // SheetJS reads CSV and Excel from the same buffer.
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'File has no data rows' });

    // Build an employeeNumber -> id map (case-insensitive, trimmed).
    const allUsers = await prisma.user.findMany({ select: { id: true, employeeNumber: true } });
    const numToId = {};
    for (const u of allUsers) {
      if (u.employeeNumber) numToId[String(u.employeeNumber).toLowerCase().trim()] = u.id;
    }
    const resolveNum = (val) => numToId[String(val).toLowerCase().trim()];

    // normalise header keys to lowercase for lookup
    const lc = (obj) => {
      const o = {};
      for (const k of Object.keys(obj)) o[k.trim().toLowerCase()] = obj[k];
      return o;
    };

    const results = { updated: [], errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = lc(rows[i]);
      const empNum = String(row['employee_number'] || row['employee_no'] || row['employee'] || row['emp_no'] || '').trim();
      if (!empNum) { results.errors.push({ row: i + 2, reason: 'Missing employee_number' }); continue; }

      const empId = resolveNum(empNum);
      if (!empId) { results.errors.push({ row: i + 2, employee: empNum, reason: 'Employee number not found' }); continue; }

      // Collect approver employee numbers — either approver1..5 columns, or a single "approvers" column.
      let approverNums = [];
      if (row['approvers']) {
        approverNums = String(row['approvers']).split(/[;,]/).map(s => s.trim()).filter(Boolean);
      } else {
        for (let n = 1; n <= 5; n++) {
          const v = row[`approver${n}_number`] || row[`approver${n}_no`] || row[`approver${n}`];
          if (v !== undefined && String(v).trim() !== '') approverNums.push(String(v).trim());
        }
      }

      // Resolve employee numbers -> ids
      const resolved = [];
      let bad = null;
      for (const num of approverNums) {
        const id = resolveNum(num);
        if (!id) { bad = num; break; }
        resolved.push(id);
      }
      if (bad) { results.errors.push({ row: i + 2, employee: empNum, reason: `Approver number not found: ${bad}` }); continue; }

      if (resolved.length === 0) { results.errors.push({ row: i + 2, employee: empNum, reason: 'No approvers given' }); continue; }

      // First approver = manager (#1); the rest are additional (#2..#5), excluding self & manager, cap 4.
      const managerId = resolved[0];
      const additional = [...new Set(resolved.slice(1))]
        .filter(id => id && id !== empId && id !== managerId)
        .slice(0, 4);

      const mode = String(row['mode'] || '').toUpperCase() === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL';
      const rule = String(row['rule'] || '').toUpperCase() === 'ANY' ? 'ANY' : 'ALL';

      try {
        await prisma.user.update({
          where: { id: empId },
          data: {
            managerId,
            approverIds: additional.length ? additional.join(',') : null,
            approvalMode: mode,
            approvalRule: rule,
          },
        });
        results.updated.push({ employee: empNum, approvers: resolved.length, mode, rule });
      } catch (e) {
        results.errors.push({ row: i + 2, employee: empNum, reason: e.message });
      }
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
