const express = require('express');
const {
  getQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  startQuiz,
  saveProgress,
  submitQuiz,
  completeExternal,
  getMyResult
} = require('../controllers/quizzes');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(getQuizzes)
  .post(authorize('admin'), createQuiz);

router
  .route('/:id')
  .get(getQuiz)
  .put(authorize('admin'), updateQuiz)
  .delete(authorize('admin'), deleteQuiz);

// Student attempt lifecycle
router.post('/:id/start', authorize('user'), startQuiz);
router.put('/:id/progress', authorize('user'), saveProgress);
router.post('/:id/submit', authorize('user'), submitQuiz);
router.post('/:id/complete-external', authorize('user'), completeExternal);
router.get('/:id/result', authorize('user'), getMyResult);

module.exports = router;
