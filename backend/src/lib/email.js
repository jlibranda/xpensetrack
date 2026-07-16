// src/lib/email.js — uses Resend (MailerSend fallback)
// Branding (name, color, logo) is read from OrgSettings so emails match the app's
// current branding. EMAIL_BRAND / EMAIL_BRAND_COLOR env vars override if set.
const ENV_APP_NAME = process.env.EMAIL_BRAND || null;
const ENV_BRAND_COLOR = process.env.EMAIL_BRAND_COLOR || null;
const FALLBACK_APP_NAME = 'Cashalo';
const FALLBACK_COLOR = '#1D9E75';

// Readable text color (black or white) for text placed on top of a brand-colored
// area in emails — black when the brand color is light (e.g. yellow), white when
// dark. Mirrors the app's on-screen contrast behavior.
function emailContrast(hex) {
  if (!hex || typeof hex !== 'string') return '#ffffff';
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return '#ffffff';
  const v = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(v(0)) + 0.7152 * lin(v(2)) + 0.0722 * lin(v(4));
  return L > 0.55 ? '#1f2937' : '#ffffff';
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getBranding() {
  let companyName = FALLBACK_APP_NAME, primaryColor = FALLBACK_COLOR, logoUrl = null, timezone = 'Asia/Manila';
  try {
    const s = await prisma.orgSettings.findFirst();
    if (s) {
      companyName = s.companyName || companyName;
      primaryColor = s.primaryColor || primaryColor;
      logoUrl = s.logoUrl || null;
      timezone = s.timezone || timezone;
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
    timezone,
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
  // AP/AR (payables & receivables) variants — used when kind='apar'.
  apar_approval_request:   { subject: 'Action required: Approve "{title}"', message: 'An AP/AR invoice from {employeeName} has been submitted and is waiting for your approval:' },
  apar_status_APPROVED:    { subject: '✅ AP/AR invoice approved — {title}',  message: 'The AP/AR invoice has been fully approved and will be processed for payment.' },
  apar_status_REJECTED:    { subject: '❌ AP/AR invoice rejected — {title}',  message: 'The AP/AR invoice was not approved. Please check the notes and resubmit if needed.' },
  apar_status_RETURNED:    { subject: '↩ AP/AR invoice returned — {title}',   message: 'The approver returned this AP/AR invoice. Please review the comments and resubmit.' },
  apar_status_PROCESSED:   { subject: '💰 AP/AR invoice processed — {title}', message: 'The AP/AR invoice has been processed for payout.' },
  apar_status_REPROCESSING:{ subject: '↻ AP/AR invoice back for reprocessing — {title}', message: 'A previously processed AP/AR invoice has been reverted and is now back for reprocessing.' },
  welcome:                 { subject: 'Welcome to {appName}!',               message: 'Your {appName} account has been created. Here are your login details:' },
  password_reset:          { subject: 'Reset your {appName} password',       message: 'Click below to reset your password. This link expires in 1 hour.' },
  // User management: admin-triggered credential emails (Users module).
  credentials:             { subject: 'Your {appName} login details',        message: 'Here are your login details for {appName}. Use the button below to open the app and sign in.' },
  credentials_reset:       { subject: 'Your {appName} password has been reset', message: 'Your password was reset by an administrator. Here are your new login details — you will be asked to change this password when you sign in.' },
  // Vendor-facing: payment notice with POP + BIR 2307 attached (AP invoices).
  vendor_payment:          { subject: 'Payment processed — {vendorName}', message: 'Please be advised that payment for the below invoice(s) has been successfully processed. The funds should now be reflected in your account. 2307 to follow.' },
  // Payment / credit notification (sent manually from the Proof of Payment panel).
  payment_notification:      { subject: '💰 Payment sent — {title}',          message: 'Good news! Your filed expense "{title}" ({amount}) has been paid/reimbursed. Proof of payment is on file.' },
  apar_payment_notification: { subject: '💰 Payment posted — {title}',        message: 'This is to confirm that "{title}" ({amount}) has been paid/credited. Proof of payment is on file.' },
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
  const onBrand = emailContrast(color); // readable text on the brand-colored header
  // Use a hosted logo if available; data-URI logos are unreliable in email clients,
  // so fall back to the company name text in that case.
  const useLogo = b.logoUrl && /^https?:\/\//i.test(b.logoUrl);
  const header = useLogo
    ? `<table style="border-collapse:collapse"><tr>
         <td style="vertical-align:middle;padding-right:10px"><img src="${b.logoUrl}" alt="${name}" style="max-height:36px;display:block" /></td>
         <td style="vertical-align:middle"><span style="color:${onBrand};font-size:18px;font-weight:600">${name}</span></td>
       </tr></table>`
    : `<h1 style="margin:0;color:${onBrand};font-size:20px;font-weight:600">${name}</h1>`;
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
  const onBrand = emailContrast(color);
  return `<a href="${url}" style="display:inline-block;background:${color};color:${onBrand};padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;margin:16px 0">${label}</a>`;
}

function row(label, value) {
  return `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%">${label}</td><td style="padding:8px 0;color:#111;font-size:14px;font-weight:500">${value}</td></tr>`;
}

async function sendMail(to, subject, htmlBody, fromName, attachments) {
  // attachments: [{ filename, content (base64 string), contentType }] — optional.
  // Build the From header. RESEND_FROM may be either a bare address
  // ("noreply@yourdomain.com") or a full header ("Cashalo <noreply@yourdomain.com>").
  const name = fromName || FALLBACK_APP_NAME;
  const buildFrom = (val) => (val && val.includes('<')) ? val : `${name} <${val}>`;
  const atts = Array.isArray(attachments) ? attachments.filter(a => a && a.filename && a.content) : [];

  // 1) Resend (preferred).
  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || process.env.EMAIL_FROM;
  if (resendKey && resendFrom) {
    try {
      const payload = { from: buildFrom(resendFrom), to: [to], subject, html: htmlBody };
      if (atts.length) payload.attachments = atts.map(a => ({ filename: a.filename, content: a.content, content_type: a.contentType || undefined }));
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) { console.log(`Email sent via Resend to ${to}: ${subject}${atts.length ? ` (${atts.length} attachment/s)` : ''}`); return true; }
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
      const payload = { from: { email: fromEmail, name }, to: [{ email: to }], subject, html: htmlBody };
      if (atts.length) payload.attachments = atts.map(a => ({ filename: a.filename, content: a.content, disposition: 'attachment' }));
      const res = await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
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

async function sendApprovalRequestEmail(toEmail, toName, expense, employee, kind = 'expense') {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const isApar = kind === 'apar';
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
  const key = isApar ? 'apar_approval_request' : 'approval_request';
  const subject = tpl(custom, key, 'subject', vars);
  const message = tpl(custom, key, 'message', vars);
  const heading = isApar ? 'New AP/AR invoice needs your approval' : 'New expense needs your approval';
  return sendMail(toEmail, subject, html(
    heading,
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

async function sendStatusUpdateEmail(toEmail, toName, expense, status, employee, kind = 'expense') {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const isApar = kind === 'apar';
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const titles = isApar ? {
    APPROVED: 'AP/AR invoice approved', REJECTED: 'AP/AR invoice rejected', RETURNED: 'AP/AR invoice returned for revision',
    MANAGER_APPROVED: 'Approved by manager', PROCESSED: 'AP/AR invoice processed', REPROCESSING: 'AP/AR invoice back for reprocessing',
  } : {
    APPROVED: 'Expense approved', REJECTED: 'Expense rejected', RETURNED: 'Expense returned for revision',
    MANAGER_APPROVED: 'Approved by manager', PROCESSED: 'Expense processed', REPROCESSING: 'Expense back for reprocessing',
  };
  const brand = await getBranding();
  const appName = brand.appName;
  const colors = { APPROVED:'#16a34a', REJECTED:'#dc2626', RETURNED:'#d97706', MANAGER_APPROVED:'#2563eb', PROCESSED: brand.brandColor, REPROCESSING: '#d97706' };
  const custom = await getTemplates();
  const emp = await employeeVars(employee || expense.submittedBy || expense.submittedById);
  const vars = { name: toName, title: expense.title, amount: amt, appName, ...emp };
  const key = `${isApar ? 'apar_status_' : 'status_'}${status}`;
  const noun = isApar ? 'AP/AR invoice' : 'Expense';
  const fallbackMsgs = {
    REPROCESSING: `A previously processed ${noun.toLowerCase()} has been reverted and is now back for reprocessing. You will receive an updated notification once it has been processed again.`,
  };
  const subject = DEFAULT_TEMPLATES[key] ? tpl(custom, key, 'subject', vars) : subst(`${noun} update — {title}`, vars);
  const message = DEFAULT_TEMPLATES[key] ? tpl(custom, key, 'message', vars) : (fallbackMsgs[status] || '');
  const title = titles[status] || `${noun} update`;
  const color = colors[status] || '#374151';
  // For processed payouts, show pay out date + remarks (and pay period if set).
  const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: brand.timezone || 'Asia/Manila' }) : '';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let extra = '';
  if (status === 'PROCESSED') {
    const lines = [];
    const payout = fmtD(expense.payoutDate || expense.processedAt);
    if (payout) lines.push(`Pay out date: ${esc(payout)}`);
    if (expense.remarks) lines.push(`Remarks: ${esc(expense.remarks)}`);
    extra = lines.map(l => `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${l}</p>`).join('');
  }
  const btnLink = isApar ? `${frontendUrl}/ap-ar` : `${frontendUrl}/expenses`;
  const btnLabel = isApar ? 'View AP &amp; AR invoices →' : 'View my expenses →';
  return sendMail(toEmail, subject, html(
    title,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <div style="background:#f9fafb;border-left:4px solid ${color};border-radius:4px;padding:16px;margin:0 0 20px">
       <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">${expense.title}</p>
       <p style="margin:0;font-size:14px;color:#6b7280">${amt}</p>
       ${extra}
     </div>
     ${btn(btnLink, btnLabel, brand)}`
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
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
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

async function sendCredentialsEmail(toEmail, toName, password, employee, templateKey = 'credentials') {
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const emp = await employeeVars(employee || { firstName: (toName||'').split(' ')[0], lastName: (toName||'').split(' ').slice(1).join(' '), email: toEmail });
  const vars = { name: toName, email: toEmail, password, appName, ...emp };
  const key = DEFAULT_TEMPLATES[templateKey] ? templateKey : 'credentials';
  const subject = tpl(custom, key, 'subject', vars);
  const message = tpl(custom, key, 'message', vars);
  return sendMail(toEmail, subject, html(
    subject,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName || 'there'},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
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

// Confirmation sent after a user successfully changes their password (e.g. after
// using the temporary credentials). Lets them know the temp password is now used/invalid.
async function sendPasswordChangedEmail(toEmail, toName) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  const when = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: brand.timezone || 'Asia/Manila' });
  return sendMail(toEmail, `Your ${appName} password was changed`, html(
    'Password updated',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName || 'there'},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">Your ${appName} password was successfully changed on <b>${when}</b>. Any temporary password that was sent to you is no longer valid — please use your new password to sign in.</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">If you did <b>not</b> make this change, please contact your Finance Department right away.</p>
     ${btn(`${frontendUrl}/login`, `Open ${appName} →`, brand)}`
  , brand), appName);
}

// Automatic reminder to a pending approver when an expense has been waiting too long.
async function sendApprovalReminderEmail(toEmail, toName, expense, employee, days, kind = 'expense') {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const noun = kind === 'apar' ? 'AP/AR invoice' : 'expense';
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  const emp = await employeeVars(employee || expense.submittedBy || expense.submittedById);
  const who = emp.employeeName || 'an employee';
  const dayTxt = days ? `${days} day${days === 1 ? '' : 's'}` : 'a while';
  return sendMail(toEmail, `Reminder: "${expense.title}" is awaiting your approval`, html(
    'Approval reminder',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName || 'there'},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">This is a friendly reminder that an ${noun} from ${who} has been waiting for your approval for <b>${dayTxt}</b>. Please review it when you can.</p>
     <div style="background:#f9fafb;border-left:4px solid ${brand.brandColor};border-radius:4px;padding:16px;margin:0 0 20px">
       <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">${expense.title}</p>
       <p style="margin:0;font-size:14px;color:#6b7280">${amt}</p>
     </div>
     ${btn(`${frontendUrl}/approvals`, 'Review approvals →', brand)}`
  , brand), appName);
}

async function sendPaymentNotificationEmail(toEmail, toName, doc, employee, kind = 'expense') {
  if (!(await notificationsEnabled())) return { skipped: true, reason: 'notifications_disabled' };
  const isApar = kind === 'apar';
  const sym = doc.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(doc.amount ?? doc.amountPhp ?? 0).toLocaleString()}`;
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const emp = await employeeVars(employee || doc.submittedBy || doc.submittedById);
  const vars = { name: toName, title: doc.title, amount: amt, appName, ...emp };
  const key = isApar ? 'apar_payment_notification' : 'payment_notification';
  const subject = tpl(custom, key, 'subject', vars);
  const message = tpl(custom, key, 'message', vars);
  const title = isApar ? 'Payment / credit posted' : 'Payment sent';
  const color = brand.brandColor;
  const btnLink = isApar ? `${frontendUrl}/ap-ar` : `${frontendUrl}/expenses`;
  const btnLabel = isApar ? 'View AP &amp; AR invoices →' : 'View my expenses →';
  return sendMail(toEmail, subject, html(
    title,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <div style="background:#f9fafb;border-left:4px solid ${color};border-radius:4px;padding:16px;margin:0 0 20px">
       <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">${doc.title}</p>
       <p style="margin:0;font-size:14px;color:#6b7280">${amt}</p>
     </div>
     ${btn(btnLink, btnLabel, brand)}`
  , brand), appName);
}

// Vendor-facing payment notice: multiple invoices, one email, with the proof of
// payment image(s) and a combined BIR 2307 PDF attached. `recipients` may contain
// several addresses (vendor email supports ";"-separated lists). Returns the
// number of recipients successfully emailed.
async function sendVendorPaymentEmail({ recipients, contactPerson, vendorName, invoices, totalPhp, paymentDate, senderName, attachments, subjectOverride, messageOverride }) {
  const brand = await getBranding();
  const appName = brand.appName;
  const custom = await getTemplates();
  const vars = { contactPerson: contactPerson || vendorName, vendorName, appName, senderName };
  const subject = (subjectOverride && subjectOverride.trim()) ? subst(subjectOverride, vars) : tpl(custom, 'vendor_payment', 'subject', vars);
  const message = (messageOverride && messageOverride.trim()) ? subst(messageOverride, vars) : tpl(custom, 'vendor_payment', 'message', vars);
  const peso = (n) => `\u20b1${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const invoiceRows = (invoices || []).map(inv =>
    row(`Invoice ${inv.docNumber || '(no number)'}`, peso(inv.amountPhp))
  ).join('');

  const body =
    `<p style="color:#374151;font-size:14px;margin:0 0 16px">Dear ${contactPerson || vendorName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 16px">Good day!</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${message}</p>
     <p style="color:#111;font-size:14px;font-weight:600;margin:0 0 8px">Payment Details</p>
     <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 20px">
       <table style="width:100%;border-collapse:collapse">
         ${invoiceRows}
         ${row('<strong>Total Amount</strong>', `<strong>${peso(totalPhp)}</strong> <span style="color:#6b7280;font-weight:400">(net of wtax)</span>`)}
         ${row('Payment Date', paymentDate)}
         ${row('Method', 'Online Transfer')}
       </table>
     </div>
     <p style="color:#374151;font-size:14px;margin:0 0 16px">Please find attached for reference. If you have any questions regarding this payment, feel free to reach out.</p>
     <p style="color:#374151;font-size:14px;margin:0 0 4px">Thank you.</p>
     <p style="color:#111;font-size:14px;font-weight:600;margin:16px 0 0">${senderName}</p>
     <p style="color:#6b7280;font-size:13px;margin:0">${appName} Finance</p>`;

  const htmlBody = html(subject, body, brand);
  let sent = 0;
  for (const to of recipients) {
    const ok = await sendMail(to, subject, htmlBody, appName, attachments);
    if (ok) sent++;
  }
  return sent;
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail, sendPasswordResetEmail, sendWelcomeEmail, sendTestEmail, sendCredentialsEmail, sendStorageFullAlert, sendPasswordChangedEmail, sendApprovalReminderEmail, sendPaymentNotificationEmail, sendVendorPaymentEmail };
