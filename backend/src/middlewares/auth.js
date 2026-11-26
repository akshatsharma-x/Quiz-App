const jwt = require('jsonwebtoken');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return next(new ErrorResponse('Please sign in to continue', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Your session has expired. Please sign in again.'
      : 'Not authorized to access this route';
    return next(new ErrorResponse(msg, 401));
  }

  const user = await User.findById(decoded.id).select('+passwordChangedAt');
  if (!user) {
    return next(new ErrorResponse('This account no longer exists', 401));
  }
  if (user.isBanned) {
    return next(new ErrorResponse('Your account has been suspended. Contact an administrator.', 403));
  }
  if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
    return next(new ErrorResponse('Your password was changed. Please sign in again.', 401));
  }

  req.user = user;
  next();
};

// Grant access to specific roles
exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ErrorResponse('You do not have permission to perform this action', 403));
  }
  next();
};
