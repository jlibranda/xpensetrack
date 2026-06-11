// src/lib/email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const formatAmount = (expense) => {
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  return `${sym}${expense.amount.toLocaleString()}`;
};

async function sendApprovalRequestEmail(toEmail, toName, expense) {
  await transporter.sendMail({
    from: `"XpenseTrack" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Action required: Expense approval for ${expense.title}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0F6E56">Expense Approval Request</h2>
        <p>Hi ${toName},</p>
        <p>A new expense has been submitted for your approval:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Description</td><td><b>${expense.title}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td><b>${formatAmount(expense)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Category</td><td>${expense.category}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Date</td><td>${new Date(expense.expenseDate).toLocaleDateString()}</td></tr>
        </table>
        <a href="${process.env.FRONTEND_URL}/approvals" 
           style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
          Review in XpenseTrack →
        </a>
      </div>
    `,
  });
}

async function sendStatusUpdateEmail(toEmail, toName, expense, status) {
  const statusMap = {
    APPROVED: { label: 'Approved ✅', color: '#3B6D11', message: 'Your expense has been fully approved and will be processed for reimbursement.' },
    REJECTED: { label: 'Rejected ❌', color: '#A32D2D', message: 'Your expense has been rejected. Please check the notes and resubmit if needed.' },
    MANAGER_APPROVED: { label: 'Manager Approved ✅', color: '#854F0B', message: 'Your expense has been approved by your manager and is now pending finance review.' },
  };
  const s = statusMap[status] || { label: status, color: '#333', message: '' };

  await transporter.sendMail({
    from: `"XpenseTrack" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Expense ${s.label}: ${expense.title}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:${s.color}">Expense ${s.label}</h2>
        <p>Hi ${toName},</p>
        <p>${s.message}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Description</td><td><b>${expense.title}</b></td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td><b>${formatAmount(expense)}</b></td></tr>
        </table>
        <a href="${process.env.FRONTEND_URL}/expenses" 
           style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
          View in XpenseTrack →
        </a>
      </div>
    `,
  });
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail };
