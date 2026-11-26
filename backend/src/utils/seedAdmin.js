const User = require('../models/User');

const strongEnough = (pw) => typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

/**
 * Ensures at least one administrator exists so a fresh deployment is usable.
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (with dev defaults).
 */
const ensureAdmin = async () => {
  // The shared demo faculty account (SHOWCASE_MODE) doesn't count as a real administrator
  const count = await User.countDocuments({ role: 'admin', email: { $not: /^demo\./ } });
  if (count > 0) return null;

  // Never create a guessable admin on a public deployment
  if (process.env.NODE_ENV === 'production' && !strongEnough(process.env.ADMIN_PASSWORD)) {
    console.error('[SEED] No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters with letters and numbers) and restart to create one.');
    return null;
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@quizmuj.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const name = process.env.ADMIN_NAME || 'QuizMUJ Admin';

  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    existing.isVerified = true;
    await existing.save({ validateBeforeSave: false });
    console.log(`[SEED] Promoted existing account ${email} to administrator.`);
    return existing;
  }

  const admin = await User.create({ name, email, password, role: 'admin', isVerified: true });
  console.log(`[SEED] Created administrator account: ${email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[SEED] Using the default admin password. Sign in and change it under Console → Settings.');
  }
  return admin;
};

module.exports = ensureAdmin;
