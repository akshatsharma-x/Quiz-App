const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // Strict Domain Check
    if (!email || !email.endsWith('@muj.manipal.edu')) {
      return next(new ErrorResponse('Registration is strictly limited to @muj.manipal.edu domains', 400));
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role
    });

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set OTP and expire (10 mins)
    user.otp = otp;
    user.otpExpire = Date.now() + 10 * 60 * 1000;
    
    await user.save({ validateBeforeSave: false });

    // Send email
    const message = `Welcome to QuizMUJ. Your OTP for account verification is: \n\n ${otp}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'QuizMUJ Account Verification',
        message
      });

      res.status(200).json({
        success: true,
        data: 'Email sent'
      });
    } catch (err) {
      console.log(err);
      user.otp = undefined;
      user.otpExpire = undefined;

      await user.save({ validateBeforeSave: false });

      return next(new ErrorResponse('Email could not be sent', 500));
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP
// @route   POST /api/v1/auth/verify-otp
// @access  Public
exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ 
      email,
      otp,
      otpExpire: { $gt: Date.now() }
    }).select('+otp +otpExpire');

    if (!user) {
      return next(new ErrorResponse('Invalid OTP or OTP has expired', 400));
    }

    // Set user as verified
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpire = undefined;

    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    console.log(`[AUTH DIAGNOSTIC] Login Attempt Initiated. Email: '${email}', Password length: ${password ? password.length : 0}`);

    // Validate email & password format
    if (!email || !password) {
      console.log(`[AUTH DIAGNOSTIC] Failed: Missing email or password`);
      return next(new ErrorResponse('Please provide an email and password', 400));
    }

    // Check for user
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      console.log(`[AUTH DIAGNOSTIC] Failed: User not found in DB for email: '${email}'`);
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    console.log(`[AUTH DIAGNOSTIC] User found. Role: ${user.role}, Password length: ${user.password ? user.password.length : 'undefined'}`);

    // Domain check only for students (not admins)
    if (user.role !== 'admin' && !email.endsWith('@muj.manipal.edu')) {
      console.log(`[AUTH DIAGNOSTIC] Failed: Domain check failed for user.role=${user.role}`);
      return next(new ErrorResponse('Access restricted to @muj.manipal.edu domains only', 401));
    }

    // Check if user is verified (skip for admins)
    if (user.role !== 'admin' && !user.isVerified) {
      console.log(`[AUTH DIAGNOSTIC] Failed: User not verified`);
      return next(new ErrorResponse('Please verify your email first', 401));
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);
    console.log(`[AUTH DIAGNOSTIC] bcrypt matchPassword returned: ${isMatch}`);

    if (!isMatch) {
      console.log(`[AUTH DIAGNOSTIC] Failed: Password does not match hash!`);
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    console.log(`[AUTH DIAGNOSTIC] Success! Generating and sending signed JWT...`);
    sendTokenResponse(user, 200, res);
  } catch (error) {
    console.log(`[AUTH DIAGNOSTIC] FATAL ERROR CATCH BLOCK: `, error);
    next(error);
  }
};
// @desc    Request Passwordless Login OTP
// @route   POST /api/v1/auth/request-login-otp
// @access  Public
exports.requestLoginOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorResponse('Please provide an email', 400));
    }
    if (!email.endsWith('@muj.manipal.edu')) {
      return next(new ErrorResponse('Access restricted to @muj.manipal.edu domains only', 401));
    }

    const user = await User.findOne({ email });

    if (!user) {
      return next(new ErrorResponse('There is no user with that email', 404));
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set OTP and expire (10 mins)
    user.otp = otp;
    user.otpExpire = Date.now() + 10 * 60 * 1000;
    
    await user.save({ validateBeforeSave: false });

    // Send email
    const message = `Welcome back to QuizMUJ! Your OTP for passwordless login is: \n\n ${otp} \n\n This OTP will expire in 10 minutes.`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'QuizMUJ Passwordless Login OTP',
        message
      });

      res.status(200).json({
        success: true,
        data: 'Login OTP sent to email'
      });
    } catch (err) {
      console.log(err);
      user.otp = undefined;
      user.otpExpire = undefined;

      await user.save({ validateBeforeSave: false });

      return next(new ErrorResponse('Email could not be sent', 500));
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Verify Passwordless Login OTP
// @route   POST /api/v1/auth/verify-login-otp
// @access  Public
exports.verifyLoginOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return next(new ErrorResponse('Please provide email and OTP', 400));
    }

    const user = await User.findOne({ 
      email,
      otp,
      otpExpire: { $gt: Date.now() }
    }).select('+otp +otpExpire');

    if (!user) {
      return next(new ErrorResponse('Invalid OTP or OTP has expired', 400));
    }

    // Reset OTP fields
    user.otp = undefined;
    user.otpExpire = undefined;

    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};
// Get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  // Create token
  const token = user.getSignedJwtToken();

  res.status(statusCode).json({
    success: true,
    token
  });
};
