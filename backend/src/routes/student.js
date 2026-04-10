const express = require('express');
const { getSmartQuizzes, updateStudentProfile } = require('../controllers/student');
const { protect } = require('../middlewares/auth');

const router = express.Router();

// All student routes require authentication
router.use(protect);

router
  .route('/my-quizzes')
  .get(getSmartQuizzes);

router
  .route('/profile')
  .put(updateStudentProfile);

module.exports = router;
