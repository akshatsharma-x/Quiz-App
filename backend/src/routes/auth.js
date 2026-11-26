const express = require('express');
const {
  register,
  verifyOtp,
  resendOtp,
  login,
  requestLoginOtp,
  verifyLoginOtp,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  updatePassword
} = require('../controllers/auth');
const { protect } = require('../middlewares/auth');
const { protectDemoAccount, noCodesForDemoEmails } = require('../middlewares/showcase');
const rateLimit = require('../utils/rateLimit');

const router = express.Router();

const FIFTEEN_MIN = 15 * 60 * 1000;

// Buckets are per account *and* network: a whole campus often shares one public IP, so
// keying on IP alone would let one class signing in before an exam lock everyone out.
const accountKey = (req) => {
  const who = req.user
    ? `u:${req.user._id}`
    : `e:${String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 254)}`;
  return `${req.ip}|${who}`;
};

// Endpoints that send email (per address – also guarded by the 45 s resend cooldown)
const emailLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: Number(process.env.RATE_LIMIT_EMAIL) || 6,
  keyPrefix: 'auth-email',
  key: accountKey,
  message: 'Too many codes requested for this email. Please wait a few minutes and try again.'
});
// Endpoints that check passwords / codes (per account; codes also burn after 5 wrong tries)
const attemptLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: Number(process.env.RATE_LIMIT_AUTH) || 20,
  keyPrefix: 'auth-attempt',
  key: accountKey,
  message: 'Too many sign-in attempts for this account. Please wait a few minutes and try again.'
});
// Flood guard per network – generous enough for a campus NAT at exam time
const networkLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: Number(process.env.RATE_LIMIT_NETWORK) || 3000,
  keyPrefix: 'auth-net',
  message: 'Too many requests from this network. Please try again in a few minutes.'
});

router.post('/register', networkLimiter, noCodesForDemoEmails, emailLimiter, register);
router.post('/verify-otp', networkLimiter, attemptLimiter, verifyOtp);
router.post('/resend-otp', networkLimiter, noCodesForDemoEmails, emailLimiter, resendOtp);
router.post('/login', networkLimiter, attemptLimiter, login);
router.post('/request-login-otp', networkLimiter, noCodesForDemoEmails, emailLimiter, requestLoginOtp);
router.post('/verify-login-otp', networkLimiter, attemptLimiter, verifyLoginOtp);
router.post('/forgot-password', networkLimiter, noCodesForDemoEmails, emailLimiter, forgotPassword);
router.post('/reset-password', networkLimiter, attemptLimiter, resetPassword);

router.route('/me').get(protect, getMe).put(protect, protectDemoAccount, updateMe);
router.put('/update-password', protect, protectDemoAccount, attemptLimiter, updatePassword);

module.exports = router;
