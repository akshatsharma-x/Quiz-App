const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000;      // 10 minutes
const MAX_ATTEMPTS = 5;                  // wrong guesses before the code is burned
const RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS) || 45 * 1000; // min gap between emails

const OTP_SELECT = '+otp +otpExpire +otpPurpose +otpAttempts +otpLastSentAt';

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// Returns seconds the caller must still wait before another OTP may be sent (0 = ok)
const cooldownRemaining = (user) => {
  if (!user.otpLastSentAt) return 0;
  const elapsed = Date.now() - new Date(user.otpLastSentAt).getTime();
  return elapsed >= RESEND_COOLDOWN_MS ? 0 : Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
};

// Mutates the user document; caller is responsible for saving it.
const issueOtp = (user, purpose) => {
  const otp = generateOtp();
  user.otp = hashOtp(otp);
  user.otpExpire = new Date(Date.now() + OTP_TTL_MS);
  user.otpPurpose = purpose;
  user.otpAttempts = 0;
  user.otpLastSentAt = new Date();
  return otp;
};

const clearOtp = (user) => {
  user.otp = undefined;
  user.otpExpire = undefined;
  user.otpPurpose = undefined;
  user.otpAttempts = 0;
};

const stateError = (user, purpose) => {
  if (!user || !user.otp || !user.otpExpire || user.otpPurpose !== purpose) {
    return 'Invalid or expired code. Please request a new one.';
  }
  if (new Date(user.otpExpire).getTime() < Date.now()) {
    return 'This code has expired. Please request a new one.';
  }
  return 'Too many incorrect attempts. Please request a new code.';
};

/**
 * Verifies a code for `email`. One guess is reserved *atomically* before comparing, so
 * parallel requests cannot exceed MAX_ATTEMPTS. Resolves { user } or { error }.
 * The returned user document includes the OTP fields (callers clear them on success).
 */
const verifyCode = async (User, email, candidate, purpose) => {
  const user = await User.findOneAndUpdate(
    { email, otpPurpose: purpose, otpExpire: { $gt: new Date() }, otpAttempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { otpAttempts: 1 } },
    { returnDocument: 'after' }
  ).select(OTP_SELECT);

  if (!user) {
    return { error: stateError(await User.findOne({ email }).select(OTP_SELECT), purpose) };
  }

  const expected = Buffer.from(user.otp, 'hex');
  const actual = Buffer.from(hashOtp(String(candidate || '').trim()), 'hex');
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!matches) {
    const left = MAX_ATTEMPTS - user.otpAttempts;
    return {
      error: left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Please request a new code.'
    };
  }
  return { user };
};

module.exports = {
  RESEND_COOLDOWN_MS,
  OTP_SELECT,
  OTP_TTL_MS,
  issueOtp,
  clearOtp,
  verifyCode,
  cooldownRemaining
};
