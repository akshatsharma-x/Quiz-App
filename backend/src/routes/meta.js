const express = require('express');
const { getCatalog } = require('../config/academics');
const { TIERS, XP_PER_POINT } = require('../utils/quizUtils');
const { demoAccounts } = require('../utils/demoData');

const router = express.Router();

// Public configuration consumed by the frontend
router.get('/academics', (req, res) => {
  res.status(200).json({ success: true, data: getCatalog() });
});

router.get('/config', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      studentEmailDomain: (process.env.STUDENT_EMAIL_DOMAIN || 'muj.manipal.edu').toLowerCase(),
      appName: 'QuizMUJ',
      xpPerPoint: XP_PER_POINT,
      tiers: TIERS,
      // Public demo deployments advertise their shared demo logins
      showcase: process.env.SHOWCASE_MODE === 'true' ? demoAccounts() : null
    }
  });
});

module.exports = router;
