const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');
const { sendOtpEmail } = require('../utils/sendEmail');
const { OTP_SELECT, RESEND_COOLDOWN_MS, issueOtp, clearOtp, verifyCode, cooldownRemaining } = require('../utils/otp');

const STUDENT_DOMAIN = () => (process.env.STUDENT_EMAIL_DOMAIN || 'muj.manipal.edu').toLowerCase();

// RFC 5321 caps addresses at 254 chars; refusing longer input also keeps validation cheap
const normEmail = (e) => {
  if (typeof e !== 'string') return '';
  const v = e.trim().toLowerCase();
  return v.length <= 254 ? v : '';
};
const isStudentEmail = (email) => email.endsWith(`@${STUDENT_DOMAIN()}`);

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters long';
  if (password.length > 128) return 'Password cannot exceed 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number';
  return null;
};

const sendTokenResponse = (user, statusCode, res, extra = {}) => {
  const token = user.getSignedJwtToken();
  res.status(statusCode).json({ success: true, token, user: user.toPublic(), ...extra });
};

// Issues and emails an OTP. Respects the resend cooldown.
const deliverOtp = async (user, purpose) => {
  const wait = cooldownRemaining(user);
  if (wait > 0) return { sent: false, resendIn: wait };
  const otp = issueOtp(user, purpose);
  await user.save({ validateBeforeSave: false });
  try {
    await sendOtpEmail(user.email, otp, purpose);
  } catch (err) {
    console.error(`[AUTH] Failed to send ${purpose} OTP:`, err.message);
    clearOtp(user);
    user.otpLastSentAt = undefined;
    await user.save({ validateBeforeSave: false });
    throw new ErrorResponse('We could not send the email right now. Please try again in a moment.', 502);
  }
  return { sent: true, resendIn: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
};

// @desc    Register student (role is always 'user')
// @route   POST /api/v1/auth/register
exports.register = async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = normEmail(req.body.email);
  const { password } = req.body;

  if (!name) return next(new ErrorResponse('Please enter your full name', 400));
  if (name.length > 80) return next(new ErrorResponse('Name cannot be more than 80 characters', 400));
  if (!email || !isStudentEmail(email)) {
    return next(new ErrorResponse(`Registration is limited to @${STUDENT_DOMAIN()} email addresses`, 400));
  }
  const pwError = validatePassword(password);
  if (pwError) return next(new ErrorResponse(pwError, 400));

  let user = await User.findOne({ email }).select(OTP_SELECT);

  if (user && (user.isVerified || user.role === 'admin')) {
    return next(new ErrorResponse('An account with this email already exists. Please sign in instead.', 409));
  }

  if (user) {
    // Unverified account (e.g. email never confirmed) – let the owner start over
    user.name = name;
    user.password = password;
    await user.save();
  } else {
    user = await User.create({ name, email, password, role: 'user' });
  }

  const { resendIn } = await deliverOtp(user, 'verify');
  res.status(200).json({
    success: true,
    data: { email, resendIn, message: `We sent a 6-digit verification code to ${email}` }
  });
};

// @desc    Verify registration OTP
// @route   POST /api/v1/auth/verify-otp
exports.verifyOtp = async (req, res, next) => {
  const email = normEmail(req.body.email);
  if (!email || !req.body.otp) return next(new ErrorResponse('Please provide your email and the code', 400));

  const { user, error } = await verifyCode(User, email, req.body.otp, 'verify');
  if (error) return next(new ErrorResponse(error, 400));

  user.isVerified = true;
  user.lastLoginAt = new Date();
  clearOtp(user);
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, res);
};

// @desc    Resend registration OTP
// @route   POST /api/v1/auth/resend-otp
exports.resendOtp = async (req, res, next) => {
  const email = normEmail(req.body.email);
  const user = email ? await User.findOne({ email }).select(OTP_SELECT) : null;
  if (!user) return next(new ErrorResponse('No pending registration found for this email', 404));
  if (user.isVerified) return next(new ErrorResponse('This email is already verified. Please sign in.', 400));

  const { sent, resendIn } = await deliverOtp(user, 'verify');
  if (!sent) return next(new ErrorResponse(`Please wait ${resendIn}s before requesting another code`, 429, { resendIn }));
  res.status(200).json({ success: true, data: { email, resendIn, message: 'A new code is on its way' } });
};

// @desc    Login user
// @route   POST /api/v1/auth/login
exports.login = async (req, res, next) => {
  const email = normEmail(req.body.email);
  const { password } = req.body;

  if (!email || typeof password !== 'string' || !password) {
    return next(new ErrorResponse('Please provide an email and password', 400));
  }

  const user = await User.findOne({ email }).select(`+password ${OTP_SELECT}`);
  if (!user || !(await user.matchPassword(password))) {
    return next(new ErrorResponse('Invalid email or password', 401));
  }

  if (user.isBanned) {
    return next(new ErrorResponse('Your account has been suspended. Contact an administrator.', 403));
  }

  if (user.role !== 'admin' && !isStudentEmail(email)) {
    return next(new ErrorResponse(`Access is restricted to @${STUDENT_DOMAIN()} accounts`, 401));
  }

  if (user.role !== 'admin' && !user.isVerified) {
    // Give the student a fresh code so they can finish verification right away
    const { sent, resendIn } = await deliverOtp(user, 'verify');
    return res.status(403).json({
      success: false,
      needsVerification: true,
      email,
      resendIn,
      error: sent
        ? 'Please verify your email first. We sent you a new code.'
        : 'Please verify your email first. Enter the code we just emailed you.'
    });
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });
  sendTokenResponse(user, 200, res);
};

// Shared by passwordless login and password reset
const requestCode = (purpose) => async (req, res, next) => {
  const email = normEmail(req.body.email);
  if (!email) return next(new ErrorResponse('Please provide an email', 400));

  const user = await User.findOne({ email }).select(OTP_SELECT);
  if (!user) {
    return next(new ErrorResponse('No account found with this email. Please register first.', 404));
  }
  if (user.role !== 'admin' && !isStudentEmail(email)) {
    return next(new ErrorResponse(`Access is restricted to @${STUDENT_DOMAIN()} accounts`, 401));
  }
  if (user.isBanned) {
    return next(new ErrorResponse('Your account has been suspended. Contact an administrator.', 403));
  }

  const { sent, resendIn } = await deliverOtp(user, purpose);
  if (!sent) {
    return next(new ErrorResponse(`Please wait ${resendIn}s before requesting another code`, 429, { resendIn }));
  }
  res.status(200).json({
    success: true,
    data: { email, resendIn, message: `We sent a 6-digit code to ${email}` }
  });
};

// @desc    Request passwordless login OTP
// @route   POST /api/v1/auth/request-login-otp
exports.requestLoginOtp = requestCode('login');

// @desc    Request password reset OTP
// @route   POST /api/v1/auth/forgot-password
exports.forgotPassword = requestCode('reset');

// @desc    Verify passwordless login OTP
// @route   POST /api/v1/auth/verify-login-otp
exports.verifyLoginOtp = async (req, res, next) => {
  const email = normEmail(req.body.email);
  if (!email || !req.body.otp) return next(new ErrorResponse('Please provide email and OTP', 400));

  const { user, error } = await verifyCode(User, email, req.body.otp, 'login');
  if (error) return next(new ErrorResponse(error, 400));
  if (user.isBanned) {
    return next(new ErrorResponse('Your account has been suspended. Contact an administrator.', 403));
  }

  clearOtp(user);
  user.isVerified = true; // receiving the code proves ownership of the inbox
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, res);
};

// @desc    Reset password with OTP
// @route   POST /api/v1/auth/reset-password
exports.resetPassword = async (req, res, next) => {
  const email = normEmail(req.body.email);
  const { otp, password } = req.body;
  if (!email || !otp) return next(new ErrorResponse('Please provide your email and the code', 400));
  const pwError = validatePassword(password);
  if (pwError) return next(new ErrorResponse(pwError, 400));

  const { user, error } = await verifyCode(User, email, otp, 'reset');
  if (error) return next(new ErrorResponse(error, 400));

  clearOtp(user);
  user.password = password;
  user.isVerified = true;
  user.lastLoginAt = new Date();
  await user.save();

  sendTokenResponse(user, 200, res);
};

// @desc    Current user
// @route   GET /api/v1/auth/me
exports.getMe = async (req, res) => {
  res.status(200).json({ success: true, data: req.user.toPublic() });
};

// @desc    Update own name
// @route   PUT /api/v1/auth/me
exports.updateMe = async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return next(new ErrorResponse('Name cannot be empty', 400));
  if (name.length > 80) return next(new ErrorResponse('Name cannot be more than 80 characters', 400));
  req.user.name = name;
  await req.user.save({ validateBeforeSave: false });
  res.status(200).json({ success: true, data: req.user.toPublic() });
};

// @desc    Change password (returns a fresh token; older sessions are revoked)
// @route   PUT /api/v1/auth/update-password
exports.updatePassword = async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select('+password');
  if (!(await user.matchPassword(currentPassword))) {
    return next(new ErrorResponse('Your current password is incorrect', 401));
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return next(new ErrorResponse(pwError, 400));
  if (currentPassword === newPassword) {
    return next(new ErrorResponse('Your new password must be different from the current one', 400));
  }
  user.password = newPassword;
  await user.save();
  sendTokenResponse(user, 200, res, { message: 'Password updated' });
};

exports.validatePassword = validatePassword;
exports.STUDENT_DOMAIN = STUDENT_DOMAIN;
