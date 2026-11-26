const ErrorResponse = require('../utils/errorResponse');
const { isDemoEmail } = require('../utils/demoData');

const showcaseMode = () => process.env.SHOWCASE_MODE === 'true';

// The demo accounts are shared by every visitor of a public demo: keep them usable for the
// next person (no password/name changes, no user management by the demo faculty account).
exports.protectDemoAccount = (req, res, next) => {
  if (showcaseMode() && req.user && isDemoEmail(req.user.email)) {
    return next(new ErrorResponse('This action is disabled for the shared demo accounts.', 403));
  }
  next();
};

// Demo accounts sign in with a password – never send one-time codes to their made-up addresses
exports.noCodesForDemoEmails = (req, res, next) => {
  if (isDemoEmail(req.body && req.body.email)) {
    return next(new ErrorResponse('Demo accounts sign in with the password shown on the sign-in page.', 403));
  }
  next();
};

exports.showcaseMode = showcaseMode;
