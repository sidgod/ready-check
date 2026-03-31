const nodemailer = require('nodemailer');

let transporter = null;

function init() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn(
      '[mailer] SMTP not configured — PIN emails will be logged to console'
    );
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendPIN(email, pin) {
  const from = process.env.SMTP_FROM || 'noreply@ready-check.dev';
  const subject = `Your ready-check PIN: ${pin}`;
  const text = [
    `Your verification PIN is: ${pin}`,
    '',
    'This PIN expires in 10 minutes.',
    '',
    'If you did not request this, please ignore this email.',
    '',
    '— ready-check',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e; margin-bottom: 8px;">ready-check</h2>
      <p style="color: #555; margin-bottom: 24px;">Your verification PIN:</p>
      <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${pin}</span>
      </div>
      <p style="color: #888; font-size: 14px;">This PIN expires in 10 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;

  if (!transporter) {
    console.log(`[mailer] PIN for ${email}: ${pin}`);
    return;
  }

  await transporter.sendMail({ from, to: email, subject, text, html });
}

module.exports = { init, sendPIN };
