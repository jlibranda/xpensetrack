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

const sym = (e) => e.currency === 'PHP' ? '₱' : '$';
const fmt = (e) => `${sym(e)}${e.amount?.toLocaleString()}`;

const STATUS_CONFIG = {
  APPROVED: { label: 'Approved ✅', color: '#3B6D11', msg: 'Your expense has been fully approved and will be processed for reimbursement.' },
  REJECTED: { label: 'Rejected ❌', color: '#A32D2D', msg: 'Your expense has been rejected. Please check the notes and resubmit if needed.' },
  RETURNED: { label: 'Returned for revision ↩', color: '#854F0B', msg: 'Your expense has been returned for revision. Please review the comments and resubmit.' },
  MANAGER_APPROVED: { label: 'Manager Approved ✅', color: '#854F0B', msg: 'Your expense has been approved by your manager and is now pending finance review.' },
};

async function sendApprovalRequestEmail(toEmail, toName, expense) {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.sendMail({
      from: `"XpenseTrack" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Action required: Expense approval for ${expense.title}`,
      html: `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0F6E56">Expense Approval Request</h2>
        <p>Hi ${toName},</p>
        <p>A new expense has been submitted for your approval:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Description</td><td><b>${expense.title}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td><b>${fmt(expense)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Category</td><td>${expense.category}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Date</td><td>${new Date(expense.expenseDate).toLocaleDateString()}</td></tr>
        </table>
        <a href="${process.env.FRONTEND_URL}/approvals" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Review in XpenseTrack →</a>
      </div>`,
    });
  } catch (err) { console.log('Email not sent (SMTP not configured):', err.message); }
}

async function sendStatusUpdateEmail(toEmail, toName, expense, status) {
  const t = getTransporter();
  if (!t) return;
  const s = STATUS_CONFIG[status] || { label: status, color: '#333', msg: '' };
  try {
    await t.sendMail({
      from: `"XpenseTrack" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Expense ${s.label}: ${expense.title}`,
      html: `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:${s.color}">Expense ${s.label}</h2>
        <p>Hi ${toName},</p>
        <p>${s.msg}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Description</td><td><b>${expense.title}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td><b>${fmt(expense)}</b></td></tr>
        </table>
        <a href="${process.env.FRONTEND_URL}/expenses" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">View in XpenseTrack →</a>
      </div>`,
    });
  } catch (err) { console.log('Email not sent:', err.message); }
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail };
