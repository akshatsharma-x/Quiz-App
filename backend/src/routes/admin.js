const express = require('express');
const multer = require('multer');
const admin = require('../controllers/admin');
const { protect, authorize } = require('../middlewares/auth');
const { protectDemoAccount } = require('../middlewares/showcase');
const ErrorResponse = require('../utils/errorResponse');

const router = express.Router();

// CSV uploads are parsed in memory (no temp files left behind)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) || /csv|excel|text\/plain/i.test(file.mimetype);
    cb(ok ? null : new ErrorResponse('Please upload a .csv file', 400), ok);
  }
});

router.use(protect, authorize('admin'));

router.get('/stats', admin.getStats);
router.get('/live', admin.getLive);

// Quizzes & results
router.post('/quizzes/external', admin.createExternalQuiz);
router.get('/quizzes/:id/results', admin.getQuizResults);
router.post('/quizzes/:id/force-end', admin.forceEndQuiz);
router.get('/results/:quizId/csv', admin.exportResultsCsv);
router.route('/results/:id').get(admin.getAttempt).delete(admin.resetAttempt);

// Question bank
router.route('/questions').get(admin.listQuestions).post(admin.createQuestion);
router.post('/questions/bulk', upload.single('file'), admin.bulkImportQuestions);
router.delete('/questions/:id', admin.deleteQuestion);

// Users
router.get('/users', admin.listUsers);
router.post('/users/promote', protectDemoAccount, admin.promoteBatch);
router.route('/users/:id').patch(protectDemoAccount, admin.updateUser).delete(protectDemoAccount, admin.deleteUser);
router.post('/admins', protectDemoAccount, admin.createAdmin);

// Announcements
router.route('/announcements').get(admin.listAnnouncements).post(admin.createAnnouncement);
router.delete('/announcements/:id', admin.deleteAnnouncement);

module.exports = router;
