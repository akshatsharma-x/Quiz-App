const express = require('express');
const { exportResultsCsv, createExternalQuiz } = require('../controllers/admin');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

router.get('/results/:quizId/csv', protect, authorize('admin'), exportResultsCsv);
router.post('/quizzes/external', protect, authorize('admin'), createExternalQuiz);

module.exports = router;
