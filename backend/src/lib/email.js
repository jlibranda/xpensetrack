// src/lib/email.js — uses MailerSend API
const appName = 'XpenseTrack';
const brandColor = '#1D9E75';

function html(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${brandColor};padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600">${appName}</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px;color:#111;font-size:18px;font-weight:600">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #f3f4f6">
      <p style="margin:0;color:#9ca3af;font-size:12px">Sent by ${appName}. Do not reply.</p>
    </div>
  </div>
</body></html>`;
}

function btn(url, label) {
  return `<a href="${url}" style="display:inline-block;background:${brandColor};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;margin:16px 0">${label}</a>`;
}

function row(label, value) {
  return `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%">${label}</td><td style="padding:8px 0;color:#111;font-size:14px;font-weight:500">${value}</td></tr>`;
}

async function sendMail(to, subject, htmlBody) {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.MAILERSEND_FROM;

  if (!apiKey || !fromEmail) {
    console.log(`[Email not configured]\nTo: ${to}\nSubject: ${subject}`);
    return false;
  }

  try {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: appName },
        to: [{ email: to }],
        subject,
        html: htmlBody,
      }),
    });

    if (res.ok || res.status === 202) {
      console.log(`Email sent via MailerSend to ${to}: ${subject}`);
      return true;
    } else {
      const data = await res.json().catch(() => ({}));
      console.error('MailerSend error:', res.status, JSON.stringify(data));
      return false;
    }
  } catch(err) {
    console.error('MailerSend failed:', err.message);
    return false;
  }
}

async function sendApprovalRequestEmail(toEmail, toName, expense) {
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const date = new Date(expense.expenseDate).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  return sendMail(toEmail, `Action required: Approve "${expense.title}"`, html(
    'New expense needs your approval',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">An expense has been submitted and is waiting for your approval:</p>
     <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
       ${row('Description', expense.title)}
       ${row('Amount', amt)}
       ${row('Category', expense.category.charAt(0) + expense.category.slice(1).toLowerCase())}
       ${row('Date', date)}
       ${expense.description ? row('Notes', expense.description) : ''}
     </table>
     ${btn(`${frontendUrl}/approvals`, 'Review & approve →')}`
  ));
}

async function sendStatusUpdateEmail(toEmail, toName, expense, status) {
  const sym = expense.currency === 'PHP' ? '₱' : '$';
  const amt = `${sym}${Number(expense.amount).toLocaleString()}`;
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  const configs = {
    APPROVED:         { subject:`✅ Expense approved — ${expense.title}`,  title:'Expense approved',              msg:'Your expense has been fully approved and will be processed for reimbursement.', color:'#16a34a' },
    REJECTED:         { subject:`❌ Expense rejected — ${expense.title}`,  title:'Expense rejected',              msg:'Your expense was not approved. Please check the notes and resubmit if needed.',  color:'#dc2626' },
    RETURNED:         { subject:`↩ Expense returned — ${expense.title}`,   title:'Expense returned for revision', msg:'Your approver returned this expense. Please review their comments and resubmit.', color:'#d97706' },
    MANAGER_APPROVED: { subject:`✓ Manager approved — ${expense.title}`,   title:'Approved by manager',           msg:'Your expense was approved by your manager and is now pending finance review.',    color:'#2563eb' },
    PROCESSED:        { subject:`💰 Expense processed — ${expense.title}`,  title:'Expense processed',            msg:'Your expense has been processed for payout.',                                   color: brandColor },
  };
  const cfg = configs[status] || { subject:`Expense update — ${expense.title}`, title:'Expense update', msg:'', color:'#374151' };
  return sendMail(toEmail, cfg.subject, html(
    cfg.title,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">${cfg.msg}</p>
     <div style="background:#f9fafb;border-left:4px solid ${cfg.color};border-radius:4px;padding:16px;margin:0 0 20px">
       <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111">${expense.title}</p>
       <p style="margin:0;font-size:14px;color:#6b7280">${amt}</p>
     </div>
     ${btn(`${frontendUrl}/expenses`, 'View my expenses →')}`
  ));
}

async function sendPasswordResetEmail(toEmail, toName, resetUrl) {
  return sendMail(toEmail, 'Reset your XpenseTrack password', html(
    'Reset your password',
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Hi ${toName},</p>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">Click below to reset your password. This link expires in <strong>1 hour</strong>.</p>
     ${btn(resetUrl, 'Reset my password →')}
     <p style="color:#9ca3af;font-size:12px;margin:20px 0 0">If you didn't request this, ignore this email.</p>`
  ));
}

async function sendWelcomeEmail(toEmail, toName, tempPassword) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://xpensetrack.vercel.app';
  return sendMail(toEmail, `Welcome to ${appName}!`, html(
    `Welcome, ${toName}!`,
    `<p style="color:#374151;font-size:14px;margin:0 0 20px">Your XpenseTrack account has been created. Here are your login details:</p>
     <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 20px">
       <table style="width:100%;border-collapse:collapse">
         ${row('Email', toEmail)}
         ${row('Password', `<code style="background:#e5e7eb;padding:2px 6px;border-radius:4px">${tempPassword}</code>`)}
       </table>
     </div>
     <p style="color:#374151;font-size:14px;margin:0 0 20px">Please log in and change your password from your profile settings.</p>
     ${btn(`${frontendUrl}/login`, 'Log in to XpenseTrack →')}`
  ));
}

module.exports = { sendApprovalRequestEmail, sendStatusUpdateEmail, sendPasswordResetEmail, sendWelcomeEmail };
