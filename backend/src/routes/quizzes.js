const express = require('express');
const {
  getQuizzes,
  getQuiz,
  createQuiz,
  submitQuiz
} = require('../controllers/quizzes');

const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

router
  .route('/')
  .get(protect, getQuizzes)
  .post(protect, authorize('admin'), createQuiz);

router
  .route('/:id')
  .get(protect, getQuiz);

router
  .route('/:id/submit')
  .post(protect, submitQuiz);

module.exports = router;
