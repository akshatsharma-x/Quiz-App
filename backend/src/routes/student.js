const express = require('express');
const {
  getSmartQuizzes,
  updateStudentProfile,
  getOverview,
  getMyResults,
  getAnalytics,
  getLeaderboard,
  getAnnouncements,
  markAnnouncementsSeen
} = require('../controllers/student');
const { protect, authorize } = require('../middlewares/auth');
const { protectDemoAccount } = require('../middlewares/showcase');

const router = express.Router();

// All student routes require authentication
router.use(protect);

router.get('/my-quizzes', authorize('user'), getSmartQuizzes);
router.put('/profile', authorize('user'), protectDemoAccount, updateStudentProfile);
router.get('/overview', authorize('user'), getOverview);
router.get('/results', authorize('user'), getMyResults);
router.get('/analytics', authorize('user'), getAnalytics);
router.get('/leaderboard', getLeaderboard); // admins may view it too
router.get('/announcements', authorize('user'), getAnnouncements);
router.post('/announcements/seen', authorize('user'), markAnnouncementsSeen);

module.exports = router;
