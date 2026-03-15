const express = require('express');
const { register, verifyOtp, login, requestLoginOtp, verifyLoginOtp } = require('../controllers/auth');

const router = express.Router();

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/request-login-otp', requestLoginOtp);
router.post('/verify-login-otp', verifyLoginOtp);

module.exports = router;
