const ErrorResponse = require('../utils/errorResponse');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const User = require('../models/User');

// @desc    Get all active quizzes
// @route   GET /api/v1/quizzes
// @access  Private
exports.getQuizzes = async (req, res, next) => {
  try {
    const currentTime = new Date();

    let query = {
      isActive: true,
      startTime: { $lte: currentTime },
      endTime: { $gte: currentTime }
    };

    // If admin, they can see all quizzes regardless of time
    if (req.user.role === 'admin') {
      query = {};
    }

    const quizzes = await Quiz.find(query).populate({
      path: 'createdBy',
      select: 'name'
    });

    res.status(200).json({
      success: true,
      count: quizzes.length,
      data: quizzes
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single quiz (Time bound check)
// @route   GET /api/v1/quizzes/:id
// @access  Private
exports.getQuiz = async (req, res, next) => {
  try {
    const quiz = await Quiz.findById(req.params.id);

    if (!quiz) {
      return next(new ErrorResponse(`Quiz not found with id of ${req.params.id}`, 404));
    }

    const currentTime = new Date();

    // Check scheduling logic (unless admin)
    if (req.user.role !== 'admin') {
      if (currentTime < quiz.startTime) {
        return next(new ErrorResponse(`This quiz has not started yet. Starts at: ${quiz.startTime}`, 403));
      }
      if (currentTime > quiz.endTime) {
        return next(new ErrorResponse(`This quiz has already ended. Ended at: ${quiz.endTime}`, 403));
      }
      if (!quiz.isActive) {
        return next(new ErrorResponse(`This quiz is no longer active.`, 403));
      }
    }

    // Strip out correctAnswer if user is not admin
    let quizData = quiz.toObject();
    
    if (req.user.role !== 'admin' && quizData.type === 'native') {
      quizData.questions = quizData.questions.map(q => {
        delete q.correctAnswer;
        return q;
      });
    }

    res.status(200).json({
      success: true,
      data: quizData
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new quiz
// @route   POST /api/v1/quizzes
// @access  Private/Admin
exports.createQuiz = async (req, res, next) => {
  try {
    // Add user to req.body
    req.body.createdBy = req.user.id;

    // Validate type requirements
    if (req.body.type === 'google_form' && !req.body.googleFormUrl) {
      return next(new ErrorResponse('Google form URL is required for google_form type quizzes', 400));
    }

    if (req.body.type === 'native' && (!req.body.questions || req.body.questions.length === 0)) {
      return next(new ErrorResponse('Questions are required for native type quizzes', 400));
    }

    const quiz = await Quiz.create(req.body);

    res.status(201).json({
      success: true,
      data: quiz
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit Native Quiz & Auto Evaluate
// @route   POST /api/v1/quizzes/:id/submit
// @access  Private
exports.submitQuiz = async (req, res, next) => {
  try {
    const quizId = req.params.id;
    const { answers, tabSwitches, timeSpentSeconds } = req.body; // array of { questionId, selectedOption }

    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      return next(new ErrorResponse(`Quiz not found with id of ${quizId}`, 404));
    }

    if (quiz.type !== 'native') {
      return next(new ErrorResponse('Endpoint only supports Native quiz submissions.', 400));
    }

    // Time window checking
    const currentTime = new Date();
    if (currentTime < quiz.startTime || currentTime > quiz.endTime) {
      return next(new ErrorResponse('Submission rejected: Outside of allowed time window.', 403));
    }

    // Check if user already submitted
    const existingResult = await Result.findOne({ user: req.user.id, quiz: quizId });
    if (existingResult) {
      return next(new ErrorResponse('You have already submitted this quiz.', 400));
    }

    // Auto Evaluate
    let score = 0;
    const totalPossibleScore = quiz.questions.length * quiz.pointsPerQuestion;

    quiz.questions.forEach(question => {
      const studentAnswer = answers.find(a => a.questionId.toString() === question._id.toString());
      if (studentAnswer && studentAnswer.selectedOption === question.correctAnswer) {
        score += quiz.pointsPerQuestion;
      }
    });

    const result = new Result({
      user: req.user.id,
      quiz: quizId,
      score,
      totalPossibleScore,
      tabSwitches: tabSwitches || 0,
      timeSpentSeconds
    });

    await result.save();

    // Update user's global points & streak
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { totalScore: score }
    });

    res.status(201).json({
      success: true,
      data: {
        score,
        totalPossibleScore,
        tabSwitchesIgnored: tabSwitches,
        resultId: result._id
      }
    });
  } catch (error) {
    next(error);
  }
};
