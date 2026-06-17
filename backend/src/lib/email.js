// src/lib/email.js — uses Resend (MailerSend fallback)
// Branding (name, color, logo) is read from OrgSettings so emails match the app's
// current branding. EMAIL_BRAND / EMAIL_BRAND_COLOR env vars override if set.
const ENV_APP_NAME = process.env.EMAIL_BRAND || null;
const ENV_BRAND_COLOR = process.env.EMAIL_BRAND_COLOR || null;
const FALLBACK_APP_NAME = 'Cashalo';
const FALLBACK_COLOR = '#1D9E75';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getBranding() {
  let companyName = FALLBACK_APP_NAME, primaryColor = FALLBACK_COLOR, logoUrl = null;
  try {
    const s = await prisma.orgSettings.findFirst();
    if (s) {
      companyName = s.companyName || companyName;
      primaryColor = s.primaryColor || primaryColor;
      logoUrl = s.logoUrl || null;
    }
  } catch (e) { /* use fallbacks */ }
  // Email clients block data-URI images, so serve the logo from a public URL.
  let emailLogoUrl = null;
  if (logoUrl) {
    if (/^https?:\/\//i.test(logoUrl)) emailLogoUrl = logoUrl;
    else if (/^data:image\//i.test(logoUrl)) {
      const apiBase = process.env.PUBLIC_API_URL || 'https://xpensetrack-production.up.railway.app/api';
      emailLogoUrl = `${apiBase.replace(/\/$/, '')}/settings/logo`;
    }
  }
  return {
    appName: ENV_APP_NAME || companyName,
    brandColor: ENV_BRAND_COLOR || primaryColor,
    logoUrl: emailLogoUrl,
  };
}

// Whether automated notification emails (approval requests, status updates) are on.
// Lets the team silence notifications during testing without touching credentials/resets.
async function notificationsEnabled() {
  try {
    const s = await prisma.orgSettings.findFirst();
    return s ? s.emailNotificationsEnabled !== false : true;
  } catch (e) { return true; }
}

// Default subject + intro message for each notification. Admins can override the
// subject and message text in Settings → Email Templates; the structured details
// (tables, buttons, branding) stay consistent. Supported placeholders are noted
// per template in the frontend editor.
const DEFAULT_TEMPLATES = {
  approval_request:        { subject: 'Action required: Approve "{title}"', message: 'An expense from {employeeName} has been submitted and is waiting for your approval:' },
  status_APPROVED:         { subject: '✅ Expense approved — {title}',       message: 'Your expense has been fully approved and will be processed for reimbursement.' },
  status_REJECTED:         { subject: '❌ Expense rejected — {title}',       message: 'Your expense was not approved. Please check the notes and resubmit if needed.' },
  status_RETURNED:         { subject: '↩ Expense returned — {title}',        message: 'Your approver returned this expense. Please review their comments and resubmit.' },
  status_MANAGER_APPROVED: { subject: '✓ Manager approved — {title}',        message: 'Your expense was approved by your manager and is now pending finance review.' },
  status_PROCESSED:        { subject: '💰 Expense processed — {title}',      message: 'Your expense has been processed for payout.' },
  status_REPROCESSING:     { subject: '↻ Expense back for reprocessing — {title}', message: 'A previously processed expense has been reverted and is now back for reprocessing. You will receive an updated notification once it has been processed again.' },
  welcome:                 { subject: 'Welcome to {appName}!',               message: 'Your {appName} account has been created. Here are your login details:' },
  password_reset:          { subject: 'Reset your {appName} password',       message: 'Click below to reset your password. This link expires in 1 hour.' },
};

async function getTemplates() {
  try {
    const s = await prisma.orgSettings.findFirst();
    if (s && s.emailTemplatesJson) return JSON.parse(s.emailTemplatesJson);
  } catch (e) { /* fall back to defaults */ }
  return {};
}

function subst(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

// Pick the custom value if the admin set a non-empty one, else the default.
function tpl(custom, key, field, vars) {
  const def = (DEFAULT_TEMPLATES[key] || {})[field] || '';
  const c = custom[key] && custom[key][field];
  const raw = (c != null && String(c).trim() !== '') ? c : def;
  return subst(raw, vars);
}

// Build employee-info placeholders from a user object or id. Looks up the full
// record by id so tags like {employeeDept} resolve regardless of what the caller
// included. Falls back to whatever object was passed, then to empty strings.
async function employeeVars(emp) {
  let u = null;
  const id = emp && (typeof emp === 'string' ? emp : emp.id);
  if (id) { try { u = await prisma.user.findUnique({ where: { id } }); } catch (e) { /* ignore */ } }
  if (!u && emp && typeof emp === 'object') u = emp;
  u = u || {};
  return {
    employeeName: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    employeeFirstName: u.firstName || '',
    employeeLastName: u.lastName || '',
    employeeEmail: u.email || '',
    employeeDept: u.department || '',
    employeePosition: u.position || '',
    employeeNumber: u.employeeNumber || '',
    employeeCostCenter: u.costCenter || '',
  };
}

function html(title, body, brand) {
  const b = brand || {};
  const name = b.appName || FALLBACK_APP_NAME;
  const color = b.brandColor || FALLBACK_COLOR;
  // Use a hosted logo if available; data-URI logos are unreliable in email clients,
  // so fall back to the company name text in that case.
  const useLogo = b.logoUrl && /^https?:\/\//i.test(b.logoUrl);
  const header = useLogo
    ? `<img src="${b.logoUrl}" alt="${name}" style="max-height:36px;display:block" /><p style="margin:8px 0 0;color:#fff;font-size:14px;font-weight:600">${name}</p>`
    : `<h1 style="margin:0;color:#fff;font-size:20px;font-weight:600">${name}</h1>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${color};padding:24px 32px">
      ${header}
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px;color:#111;font-size:18px;font-weight:600">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
      <p style="margin:0;color:#9ca3af;font-size:12px">Sent by ${name}. Do not reply.</p>
    </div>
  </div>
</body></html>`;
}

function btn(url, label, brand) {
  const color = (brand && brand.brandColor) || FALLBACK_COLOR;
  return `<a href="${url}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;margin:16px 0">${label}</a>`;
}

function row(label, value) {
  return `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%">${label}</td><td style="padding:8px 0;color:#111;font-size:14px;font-weight:500">${value}</td></tr>`;
}

async function sendMail(to, subject, htmlBody, fromName) {
  // Build the From header. RESEND_FROM may be either a bare address
  // ("noreply@yourdomain.com") or a full header ("Cashalo <noreply@yourdomain.com>").
  const name = fromName || FALLBACK_APP_NAME;
  const buildFrom = (val) => (val && val.includes('<')) ? val : `${name} <${val}>`;

  // 1) Resend (preferred).
  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || process.env.EMAIL_FROM;
  if (resendKey && resendFrom) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({ from: buildFrom(resendFrom), to: [to], subject, html: htmlBody }),
      });
      if (res.ok) { console.log(`Email sent via Resend to ${to}: ${subject}`); return true; }
      const data = await res.json().catch(() => ({}));
      console.error('Resend error:', res.status, JSON.stringify(data));
      return false;
    } catch (err) { console.error('Resend failed:', err.message); return false; }
  }

  // 2) MailerSend (legacy fallback, if still configured).
  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.MAILERSEND_FROM;
  if (apiKey && fromEmail) {
    try {
      const res = await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ from: { email: fromEmail, name }, to: [{ email: to }], subject, html: htmlBody }),
      });
      if (res.ok || res.status === 202) { console.log(`Email sent via MailerSend to ${to}: ${subject}`); return true; }
      const data = await res.json().catch(() => ({}));
      console.error('MailerSend error:', res.status, JSON.stringify(data));
      return false;
    } catch (err) { console.error('MailerSend failed:', err.message); return false; }
  }

  // 3) Nothing configured.
  console.log(`[Email not configured]\nTo: ${to}\nSubject: ${subject}`);
  return false;
}

async function sendApprovalRequestEmail(toEmail, toName, expense, employee) {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const date = new Date(expense.expenseDate).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const cat = expense.category ? (expense.category.charAt(0) + expense.category.slice(1).toLowerCase()) : '';
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const emp = await employeeVars(employee || expense.submittedBy || expense.submittedById);
  const vars = { name: toName, title: expense.title, amount: amt, category: cat, date, appName, ...emp };
  const subject = tpl(custom, 'approval_request', 'subject', vars);
  const message = tpl(custom, 'approval_request', 'message', vars);
  return sendMail(toEmail, subject, html(
    'New expense needs your approval',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
       ${row('Description', expense.title)}
       ${row('Amount', amt)}
       ${row('Category', cat)}
       ${row('Date', date)}
       ${expense.description ? row('Notes', expense.description) : ''}
     </table>
     ${btn(`${frontendUrl}/approvals`, 'Review & approve →', brand)}`
  , brand), appName);
}

async function sendStatusUpdateEmail(toEmail, toName, expense, status, employee) {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const titles = {
    APPROVED: 'Expense approved', REJECTED: 'Expense rejected', RETURNED: 'Expense returned for revision',
    MANAGER_APPROVED: 'Approved by manager', PROCESSED: 'Expense processed',
    REPROCESSING: 'Expense back for reprocessing',
  };
  const brand = await getBranding();
  const appName = brand.appName;
  const colors = { APPROVED:'#16a34a', REJECTED:'#dc2626', RETURNED:'#d97706', MANAGER_APPROVED:'#2563eb', PROCESSED: brand.brandColor, REPROCESSING: '#d97706' };
  const custom = await getTemplates();
  const emp = await employeeVars(employee || expense.submittedBy || expense.submittedById);
  const vars = { name: toName, title: expense.title, amount: amt, appName, ...emp };
  const key = `status_${status}`;
  const fallbackMsgs = {
    REPROCESSING: 'A previously processed expense has been reverted and is now back for reprocessing. You will receive an updated notification once it has been processed again.',
  };
  const subject = DEFAULT_TEMPLATES[key] ? tpl(custom, key, 'subject', vars) : subst(`Expense update — {title}`, vars);
  const message = DEFAULT_TEMPLATES[key] ? tpl(custom, key, 'message', vars) : (fallbackMsgs[status] || '');
  const title = titles[status] || 'Expense update';
  const color = colors[status] || '#374151';
  // For processed payouts, show pay out date + remarks (and pay period if set).
  const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let extra = '';
  if (status === 'PROCESSED') {
    const lines = [];
    const payout = fmtD(expense.payoutDate || expense.processedAt);
    if (payout) lines.push(`Pay out date: ${esc(payout)}`);
    if (expense.remarks) lines.push(`Remarks: ${esc(expense.remarks)}`);
    extra = lines.map(l => `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${l}</p>`).join('');
  }
  return sendMail(toEmail, subject, html(
    title,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <div style="background:#f9fafb;border-left:4px solid ${color};border-radius:4px;padding:16px;margin:0 0 20px">
       <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">${expense.title}</p>
       <p style="margin:0;font-size:14px;color:#6b7280">${amt}</p>
       ${extra}
     </div>
     ${btn(`${frontendUrl}/expenses`, 'View my expenses →', brand)}`
  , brand), appName);
}

async function sendPasswordResetEmail(toEmail, toName, resetUrl, employee) {
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const emp = await employeeVars(employee || { firstName: (toName||'').split(' ')[0], lastName: (toName||'').split(' ').slice(1).join(' '), email: toEmail });
  const vars = { name: toName, appName, ...emp };
  const subject = tpl(custom, 'password_reset', 'subject', vars);
  const message = tpl(custom, 'password_reset', 'message', vars);
  return sendMail(toEmail, subject, html(
    'Reset your password',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     ${btn(resetUrl, 'Reset my password →', brand)}
     <p style="color:#9ca3af;font-size:12px;margin:20px 0 0">If you didn't request this, ignore this email.</p>`
  , brand), appName);
}

async function sendWelcomeEmail(toEmail, toName, tempPassword, employee) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const emp = await employeeVars(employee || { firstName: (toName||'').split(' ')[0], lastName: (toName||'').split(' ').slice(1).join(' '), email: toEmail });
  const vars = { name: toName, email: toEmail, password: tempPassword, appName, ...emp };
  const subject = tpl(custom, 'welcome', 'subject', vars);
  const message = tpl(custom, 'welcome', 'message', vars);
  return sendMail(toEmail, subject, html(
    `Welcome, ${toName}!`,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 20px">
       <table style="width:100%;border-collapse:collapse">
         ${row('Email', toEmail)}
         ${row('Password', `<code style="background:#e5e7eb;padding:2px 6px;border-radius:4px">${tempPassword}</code>`)}
       </table>
     </div>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">Please log in and change your password from your profile settings.</p>
     ${btn(`${frontendUrl}/login`, `Log in to ${appName} →`, brand)}`
  , brand), appName);
}

async function sendTestEmail(toEmail, toName) {
  const brand = await getBranding();
  return sendMail(toEmail, `${brand.appName} — test email`, html(
    'Test email',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName || 'there'},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">If you're reading this, email delivery is working. 🎉</p>
     <p style="color:#9ca3af;font-size:12px;margin:20px 0 0">Sent as a configuration test.</p>`
  , brand), brand.appName);
}

async function sendCredentialsEmail(toEmail, toName, password, employee) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  return sendMail(toEmail, `Your ${appName} login details`, html(
    `Your ${appName} login details`,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName || 'there'},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">Here are your login details for ${appName}. Use the button below to open the app and sign in.</p>
     <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 20px">
       <table style="width:100%;border-collapse:collapse">
         ${row('Username (email)', toEmail)}
         ${row('Password', `<code style="background:#e5e7eb;padding:2px 6px;border-radius:4px">${password}</code>`)}
       </table>
     </div>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">For your security, please sign in and change your password from your profile settings.</p>
     ${btn(`${frontendUrl}/login`, `Open ${appName} →`, brand)}`
  , brand), appName);
}

// Alerts all active admins that storage is full, so they can download + purge
// receipts. Throttled to at most once per hour (in-memory). Reads only (works
// even when the DB disk is full, since reads don't extend files).
let _lastDiskAlert = 0;
async function sendStorageFullAlert() {
  const now = Date.now();
  if (now - _lastDiskAlert < 60 * 60 * 1000) return false; // at most 1/hour
  _lastDiskAlert = now;
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true } });
    if (!admins.length) return false;
    const brand = await getBranding();
    const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
    for (const a of admins) {
      if (!a.email) continue;
      await sendMail(a.email, `[${brand.appName}] Storage is full — action needed`, html(
        'Storage is full',
        `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${a.firstName || 'there'},</p>
         <p style="color:#374151;font-size:14px;margin:0 0 20px">The ${brand.appName} database storage is full. Receipt uploads and some other actions may be failing right now.</p>
         <p style="color:#374151;font-size:14px;margin:0 0 20px">To free up space, open Settings and use <b>Receipt storage</b> to download a backup of all receipts, then purge them.</p>
         ${btn(`${frontendUrl}/settings`, 'Open settings →', brand)}`
      , brand), brand.appName).catch(() => {});
    }
    return true;
  } catch (e) { console.error('storage-full alert failed:', e.message); return false; }
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail, sendPasswordResetEmail, sendWelcomeEmail, sendTestEmail, sendCredentialsEmail, sendStorageFullAlert };
