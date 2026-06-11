// src/lib/email.js
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

const fmt = (e) => `${e.currency==='PHP'?'₱':'$'}${e.amount?.toLocaleString()}`;

async function sendMail(opts) {
  const t = getTransporter();
  if (!t) { console.log('Email not configured. Subject:', opts.subject); return; }
  try { await t.sendMail({ from: `"XpenseTrack" <${process.env.SMTP_USER}>`, ...opts }); }
  catch(err) { console.log('Email failed:', err.message); }
}

async function sendApprovalRequestEmail(toEmail, toName, expense) {
  await sendMail({
    to: toEmail,
    subject: `Action required: ${expense.title}`,
    html: `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#0F6E56">New expense to approve</h2>
      <p>Hi ${toName}, a new expense needs your approval:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#666">Description</td><td><b>${expense.title}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Amount</td><td><b>${fmt(expense)}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Category</td><td>${expense.category}</td></tr>
      </table>
      <a href="${process.env.FRONTEND_URL}/approvals" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Review →</a>
    </div>`,
  });
}

async function sendStatusUpdateEmail(toEmail, toName, expense, status) {
  const map = {
    APPROVED: { label:'Approved ✅', msg:'Your expense has been approved for reimbursement.' },
    REJECTED: { label:'Rejected ❌', msg:'Your expense was rejected. Check the approval notes.' },
    RETURNED: { label:'Returned ↩', msg:'Your expense was returned for revision. Please check the comments and resubmit.' },
    MANAGER_APPROVED: { label:'Manager Approved', msg:'Approved by manager, now pending finance review.' },
  };
  const s = map[status] || { label: status, msg: '' };
  await sendMail({
    to: toEmail,
    subject: `Expense ${s.label}: ${expense.title}`,
    html: `<div style="font-family:sans-serif;max-width:480px">
      <h2>${s.label}</h2>
      <p>Hi ${toName}, ${s.msg}</p>
      <p><b>${expense.title}</b> — ${fmt(expense)}</p>
      <a href="${process.env.FRONTEND_URL}/expenses" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">View in XpenseTrack →</a>
    </div>`,
  });
}

async function sendPasswordResetEmail(toEmail, toName, resetUrl) {
  await sendMail({
    to: toEmail,
    subject: 'Reset your XpenseTrack password',
    html: `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#0F6E56">Reset your password</h2>
      <p>Hi ${toName}, click below to reset your password. Link expires in 1 hour.</p>
      <a href="${resetUrl}" style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Reset password →</a>
      <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
    </div>`,
  });
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail, sendPasswordResetEmail };
