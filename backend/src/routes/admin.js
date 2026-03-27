const express = require('express');
const multer = require('multer');
const { exportResultsCsv, createExternalQuiz, bulkImportQuestions } = require('../controllers/admin');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

// Multer Config for transient disk storage
const upload = multer({ dest: 'uploads/' });

router.get('/results/:quizId/csv', protect, authorize('admin'), exportResultsCsv);
router.post('/quizzes/external', protect, authorize('admin'), createExternalQuiz);
router.post('/questions/bulk', protect, authorize('admin'), upload.single('file'), bulkImportQuestions);

module.exports = router;
