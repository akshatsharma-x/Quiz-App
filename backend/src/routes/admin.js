const express = require('express');
const { exportResultsCsv } = require('../controllers/admin');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

router.get('/results/:quizId/csv', protect, authorize('admin'), exportResultsCsv);

module.exports = router;
