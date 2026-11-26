const nodemailer = require('nodemailer');

let transporter;

// Two delivery channels:
//  • Brevo's HTTPS API (BREVO_API_KEY) – works on hosts that block SMTP ports, e.g. free
//    tiers of Render/Railway. Free Brevo plan: 300 emails/day, no own domain needed.
//  • SMTP (SMTP_EMAIL + SMTP_PASSWORD, e.g. a Gmail App Password).
const brevoConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim().toLowerCase() !== 'none');
const smtpConfigured = () => Boolean(process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD);
const emailConfigured = () => brevoConfigured() || smtpConfigured();

const sendViaBrevo = async ({ fromEmail, fromName, to, subject, text, html }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject,
        htmlContent: html || `<p>${escapeHtml(text)}</p>`,
        textContent: text
      }),
      signal: controller.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Brevo API ${res.status}: ${body.message || body.code || 'request failed'}`);
    return body.messageId || 'brevo';
  } finally {
    clearTimeout(timer);
  }
};

const getTransporter = () => {
  if (transporter) return transporter;
  const auth = { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD };
  transporter = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth
      })
    : nodemailer.createTransport({ service: 'gmail', auth });
  return transporter;
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Branded HTML email for one-time codes
const otpTemplate = ({ heading, intro, code, footer }) => `
<!doctype html>
<html><body style="margin:0;background:#0b1020;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#121a2f;border-radius:16px;overflow:hidden;border:1px solid #1f2a44;">
        <tr><td style="background:linear-gradient(135deg,#ff7900,#ff4d00);padding:22px 28px;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:.5px;">QuizMUJ</span>
        </td></tr>
        <tr><td style="padding:28px;color:#e2e8f0;">
          <h1 style="margin:0 0 10px;font-size:20px;color:#fff;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 22px;line-height:1.6;color:#94a3b8;">${escapeHtml(intro)}</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#ff7900;background:#0b1020;border:1px dashed #ff7900;border-radius:12px;padding:16px 0;text-align:center;">${escapeHtml(code)}</div>
          <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

/**
 * Sends an email. In non-production environments a delivery failure (or missing SMTP
 * configuration) is logged together with the message so local development is never
 * blocked by email infrastructure. In production a failure throws.
 */
const sendEmail = async (options) => {
  const isProd = process.env.NODE_ENV === 'production';

  if (!emailConfigured()) {
    if (isProd) throw new Error('Email is not configured (set BREVO_API_KEY or SMTP_EMAIL/SMTP_PASSWORD)');
    console.warn(`[EMAIL:DEV] Email not configured. Email to ${options.email} — ${options.subject}\n${options.message}`);
    return { delivered: false };
  }

  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_EMAIL;
  const fromName = process.env.FROM_NAME || 'QuizMUJ';

  try {
    let messageId;
    if (brevoConfigured()) {
      if (!fromEmail) throw new Error('FROM_EMAIL must be set to a sender verified in Brevo');
      messageId = await sendViaBrevo({ fromEmail, fromName, to: options.email, subject: options.subject, text: options.message, html: options.html });
    } else {
      const info = await getTransporter().sendMail({
        from: `${fromName} <${fromEmail}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html
      });
      messageId = info.messageId;
    }
    console.log(`[EMAIL] Sent "${options.subject}" (${messageId})`);
    return { delivered: true };
  } catch (err) {
    if (isProd) throw err;
    console.warn(`[EMAIL:DEV] Delivery failed (${err.message}). Email to ${options.email} — ${options.subject}\n${options.message}`);
    return { delivered: false };
  }
};

const OTP_COPY = {
  verify: {
    subject: 'Verify your QuizMUJ account',
    heading: 'Verify your email',
    intro: 'Welcome to QuizMUJ! Use the code below to verify your university email address.'
  },
  login: {
    subject: 'Your QuizMUJ sign-in code',
    heading: 'Sign in to QuizMUJ',
    intro: 'Use the code below to sign in without your password.'
  },
  reset: {
    subject: 'Reset your QuizMUJ password',
    heading: 'Reset your password',
    intro: 'Use the code below to choose a new password for your account.'
  }
};

const sendOtpEmail = (email, otp, purpose) => {
  const copy = OTP_COPY[purpose];
  const footer = 'This code expires in 10 minutes. If you did not request it, you can safely ignore this email.';
  return sendEmail({
    email,
    subject: copy.subject,
    message: `${copy.intro}\n\nYour code: ${otp}\n\n${footer}`,
    html: otpTemplate({ heading: copy.heading, intro: copy.intro, code: otp, footer })
  });
};

module.exports = sendEmail;
module.exports.sendOtpEmail = sendOtpEmail;
