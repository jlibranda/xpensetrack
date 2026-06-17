// src/routes/users.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole, requirePermission } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const prisma = new PrismaClient();
const { logAudit } = require('../lib/audit');
const { reapplyApprovalFlowForUser } = require('../lib/approvalFlow');
const { getFlowSteps } = require('../lib/approvalChain');

const userSelect = {
  id:true, employeeNumber:true, firstName:true, lastName:true,
  email:true, role:true, department:true, costCenter:true,
  position:true, payrollAccount:true, isActive:true, managerId:true,
  approverIds:true, approvalMode:true, approvalRule:true, approvalFlowJson:true,
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

    // Resolve the approval flow as STEPS for display (each with people + rule).
    const steps = getFlowSteps(user);
    const allIds = [...new Set(steps.flatMap(s => s.approvers))];
    let byId = {};
    if (allIds.length) {
      const people = await prisma.user.findMany({
        where: { id: { in: allIds } },
        select: { id: true, firstName: true, lastName: true, role: true, employeeNumber: true },
      });
      for (const p of people) byId[p.id] = p;
    }
    // Step flow with resolved person objects.
    user.approvalSteps = steps.map((s, i) => ({
      stepOrder: i + 1,
      rule: s.rule,
      approvers: s.approvers.map(id => byId[id]).filter(Boolean),
    }));
    // Flat list too (kept for any older UI references).
    user.approvers = allIds.map(id => byId[id]).filter(Boolean);
    res.json(user);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PATCH update user
router.patch('/:id', authenticate, requirePermission('manage_users'), async (req, res) => {
  try {
    const { role, department, managerId, costCenter, position, payrollAccount, isActive, employeeNumber, firstName, lastName, email, newPassword,
            approverIds, approvalMode, approvalRule, approvalFlow } = req.body;

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

    // Email change (login identity) — validate format + uniqueness.
    let emailUpdate;
    if (email !== undefined && email !== null) {
      const e = String(email).trim().toLowerCase();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'A valid email is required' });
      if (e !== (target.email || '').toLowerCase()) {
        const all = await prisma.user.findMany({ select: { id: true, email: true } });
        if (all.some(u => u.id !== req.params.id && (u.email || '').toLowerCase() === e)) {
          return res.status(409).json({ error: 'That email is already in use by another user' });
        }
      }
      emailUpdate = e;
    }

    const updateData = {
      role, department, managerId: managerId||null, costCenter: costCenter||null,
      position: position||null, payrollAccount: payrollAccount||null, isActive,
      employeeNumber: employeeNumber||null, firstName, lastName,
      ...(emailUpdate !== undefined ? { email: emailUpdate } : {}),
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

    // New step-based approval flow: [{ approvers:[id...], rule:'ANY'|'ALL' }]
    if (approvalFlow !== undefined) {
      let steps = [];
      if (Array.isArray(approvalFlow)) {
        steps = approvalFlow
          .map(s => ({
            approvers: [...new Set((s.approvers || []).filter(x => x && x !== req.params.id))],
            rule: s.rule === 'ALL' ? 'ALL' : 'ANY',
          }))
          .filter(s => s.approvers.length > 0);
      }
      updateData.approvalFlowJson = steps.length ? JSON.stringify(steps) : null;
      // Flatten all approver ids for team-scope compatibility.
      const flat = [...new Set(steps.flatMap(s => s.approvers))];
      updateData.approverIds = flat.length ? flat.join(',') : null;
    }
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updateData.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: userSelect,
    });
    if (role && role !== target.role) {
      await logAudit(req.user, 'USER_ROLE_CHANGED', { targetType: 'USER', targetId: req.params.id, details: `${target.firstName||''} ${target.lastName||''}`.trim() + `: ${target.role} → ${role}` });
    }

    // If the approval flow changed AND the org has auto-reapply enabled,
    // re-route this employee's already-pending expenses to the new flow.
    const flowChanged =
      (managerId !== undefined && (managerId||null) !== (target.managerId||null)) ||
      (approverIds !== undefined) ||
      (approvalMode !== undefined) ||
      (approvalRule !== undefined) ||
      (approvalFlow !== undefined);
    if (flowChanged) {
      try {
        const org = await prisma.orgSettings.findFirst();
        if (org?.autoReapplyApprovalFlow) {
          const r = await reapplyApprovalFlowForUser(req.params.id);
          await logAudit(req.user, 'APPROVAL_FLOW_REAPPLIED', { targetType: 'USER', targetId: req.params.id, details: `Auto re-applied flow: ${r.updated||0} re-routed, ${r.autoApproved||0} auto-approved` });
        }
      } catch (e) { console.error('auto-reapply failed:', e.message); }
    }

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
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } });
    await logAudit(req.user, 'USER_PASSWORD_RESET', { targetType: 'USER', targetId: req.params.id, details: `Reset password for ${target.firstName||''} ${target.lastName||''}`.trim() });
    res.json({ message: 'Password reset successfully' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Generate a readable temporary password (no ambiguous chars like O/0/I/l/1).
function genTempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = require('crypto').randomBytes(len);
  let p = '';
  for (let i = 0; i < len; i++) p += chars[bytes[i] % chars.length];
  return p;
}

// POST send credentials — emails the user their username + a fresh temporary
// password + a link to the app. NOTE: existing passwords are stored hashed and
// cannot be retrieved, so this sets a new temporary password and sends that.
router.post('/:id/send-credentials', authenticate, requirePermission('send_credentials'), async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only an admin can send credentials for an admin account' });
    }
    if (target.isActive === false) {
      return res.status(400).json({ error: 'This account is deactivated. Reactivate it before sending credentials.' });
    }
    const tempPassword = genTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await prisma.user.update({ where: { id: target.id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } });
    const { sendCredentialsEmail } = require('../lib/email');
    const ok = await sendCredentialsEmail(target.email, `${target.firstName||''} ${target.lastName||''}`.trim(), tempPassword, target);
    await logAudit(req.user, 'USER_CREDENTIALS_SENT', { targetType: 'USER', targetId: target.id, details: `Sent login credentials to ${target.email}` });
    if (ok === false) {
      return res.status(400).json({ error: 'A new password was set, but the email could not be sent. Check email settings (RESEND_API_KEY / RESEND_FROM).' });
    }
    res.json({ message: `Login credentials sent to ${target.email}.` });
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
      await sendWelcomeEmail(created.email, `${created.firstName} ${created.lastName}`, password, created).catch(()=>{});
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
      // Skip guide/comment lines (start with #) and blank rows silently.
      if (empNum.startsWith('#') || (!empNum && Object.values(row).every(v => String(v).trim()==='' || String(v).trim().startsWith('#')))) continue;
      if (!empNum) { results.errors.push({ row: i + 2, reason: 'Missing employee_number' }); continue; }

      const empId = resolveNum(empNum);
      if (!empId) { results.errors.push({ row: i + 2, employee: empNum, reason: 'Employee number not found' }); continue; }

      // Each step is a column step1..step8. Within a cell:
      //   "/" separates approvers in an ANY (OR) step  e.g. EMP-3/EMP-4
      //   "+" separates approvers in an ALL (AND) step e.g. EMP-3+EMP-4
      //   a single number is just that one approver.
      const steps = [];
      let bad = null;
      for (let n = 1; n <= 8; n++) {
        const raw = row[`step${n}`];
        if (raw === undefined || String(raw).trim() === '') continue;
        const cell = String(raw).trim();
        const isAnd = cell.includes('+');
        const parts = cell.split(/[+/]/).map(s => s.trim()).filter(Boolean);
        const ids = [];
        for (const p of parts) {
          const id = resolveNum(p);
          if (!id) { bad = p; break; }
          if (id !== empId) ids.push(id);
        }
        if (bad) break;
        if (ids.length) steps.push({ approvers: [...new Set(ids)], rule: isAnd ? 'ALL' : 'ANY' });
      }
      if (bad) { results.errors.push({ row: i + 2, employee: empNum, reason: `Approver number not found: ${bad}` }); continue; }

      // Backward compat: if no step columns given, fall back to approver1..5 (each its own step).
      if (steps.length === 0) {
        for (let n = 1; n <= 5; n++) {
          const v = row[`approver${n}_number`] || row[`approver${n}_no`] || row[`approver${n}`];
          if (v !== undefined && String(v).trim() !== '') {
            const id = resolveNum(String(v).trim());
            if (!id) { bad = String(v).trim(); break; }
            if (id !== empId) steps.push({ approvers: [id], rule: 'ANY' });
          }
        }
        if (bad) { results.errors.push({ row: i + 2, employee: empNum, reason: `Approver number not found: ${bad}` }); continue; }
      }

      if (steps.length === 0) { results.errors.push({ row: i + 2, employee: empNum, reason: 'No approval steps given' }); continue; }

      const mode = String(row['mode'] || '').toUpperCase() === 'ANY_ORDER' ? 'ANY_ORDER' : 'SEQUENTIAL';
      const flatApprovers = [...new Set(steps.flatMap(s => s.approvers))];

      try {
        await prisma.user.update({
          where: { id: empId },
          data: {
            approvalFlowJson: JSON.stringify(steps),
            approverIds: flatApprovers.length ? flatApprovers.join(',') : null,
            approvalMode: mode,
          },
        });
        results.updated.push({ employee: empNum, steps: steps.length, mode });
      } catch (e) {
        results.errors.push({ row: i + 2, employee: empNum, reason: e.message });
      }
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: permanently delete employees (by ids) AND all their expenses/approvals.
router.post('/bulk-delete', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'No users selected' });
    }
    // Never allow deleting yourself or any ADMIN through this bulk tool.
    const targets = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true } });
    const deletable = targets.filter(u => u.role !== 'ADMIN' && u.id !== req.user.id).map(u => u.id);
    const skipped = targets.length - deletable.length;
    if (deletable.length === 0) {
      return res.status(400).json({ error: 'Nothing to delete (admins and your own account are protected).' });
    }

    let deleted = 0;
    for (const uid of deletable) {
      // Find this user's expenses
      const exp = await prisma.expense.findMany({ where: { submittedById: uid }, select: { id: true } });
      const expIds = exp.map(e => e.id);

      await prisma.$transaction([
        // approvals where this user is the approver
        prisma.approval.deleteMany({ where: { approverId: uid } }),
        // approvals attached to this user's expenses
        ...(expIds.length ? [prisma.approval.deleteMany({ where: { expenseId: { in: expIds } } })] : []),
        // this user's expenses
        prisma.expense.deleteMany({ where: { submittedById: uid } }),
        // password resets
        prisma.passwordReset.deleteMany({ where: { userId: uid } }),
        // detach this user as manager from anyone who reports to them
        prisma.user.updateMany({ where: { managerId: uid }, data: { managerId: null } }),
        // finally delete the user
        prisma.user.delete({ where: { id: uid } }),
      ]);

      // Also strip this user's id from any other user's additional approverIds list.
      const others = await prisma.user.findMany({ where: { approverIds: { contains: uid } }, select: { id: true, approverIds: true } });
      for (const o of others) {
        const cleaned = (o.approverIds || '').split(',').map(s => s.trim()).filter(Boolean).filter(id => id !== uid);
        await prisma.user.update({ where: { id: o.id }, data: { approverIds: cleaned.length ? cleaned.join(',') : null } });
      }
      deleted++;
    }

    await logAudit(req.user, 'USER_BULK_DELETED', { targetType: 'USER', details: `Deleted ${deleted} employee(s)${skipped?`, skipped ${skipped}`:''}` });
    res.json({ deleted, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN/FINANCE: manually re-apply the employee's current approval flow to their
// pending expenses (works regardless of the org auto-reapply setting).
router.post('/:id/reapply-approval-flow', authenticate, requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Not found' });
    const r = await reapplyApprovalFlowForUser(req.params.id);
    await logAudit(req.user, 'APPROVAL_FLOW_REAPPLIED', { targetType: 'USER', targetId: req.params.id, details: `Manual re-apply: ${r.updated||0} re-routed, ${r.autoApproved||0} auto-approved (of ${r.total||0} pending)` });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
