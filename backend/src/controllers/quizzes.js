const mongoose = require('mongoose');
const ErrorResponse = require('../utils/errorResponse');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const realtime = require('../realtime');
const { validateTargeting } = require('../config/academics');
const { finalizeAttempt, finalizeExpiredAttempts, xpFor } = require('../services/attempts');
const {
  SUBMISSION_GRACE_MS,
  pickTargets,
  matchesCohort,
  cohortFilterFor,
  quizStatus,
  canRevealAnswers,
  revealTime,
  toStudentQuizSummary,
  questionsForAttempt,
  toAnswerMap,
  toTimeMap,
  percentage
} = require('../utils/quizUtils');

const isAdmin = (req) => req.user && req.user.role === 'admin';
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);

const EDITABLE_FIELDS = [
  'title', 'description', 'googleFormUrl', 'timeLimit', 'pointsPerQuestion', 'passPercentage',
  'shuffleQuestions', 'shuffleOptions', 'answerReveal', 'startTime', 'endTime', 'isActive',
  'targetProgram', 'targetBranch', 'targetBatchYear', 'targetSemester', 'targetSection'
];

const sanitizeQuestions = (questions) => (Array.isArray(questions) ? questions : []).map((q) => ({
  questionText: typeof q.questionText === 'string' ? q.questionText.trim() : q.questionText,
  options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o.trim() : o)) : q.options,
  correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : q.correctAnswer,
  tags: Array.isArray(q.tags)
    ? q.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 10)
    : [],
  explanation: typeof q.explanation === 'string' ? q.explanation.trim() : undefined
}));

const TARGET_KEYS = ['targetProgram', 'targetBranch', 'targetBatchYear', 'targetSemester', 'targetSection'];

// Builds a whitelisted quiz payload from the request body
const buildQuizPayload = (body, { partial = false } = {}) => {
  const payload = {};
  EDITABLE_FIELDS.forEach((f) => {
    if (body[f] !== undefined) payload[f] = body[f];
  });
  if (!partial || TARGET_KEYS.some((k) => body[k] !== undefined)) Object.assign(payload, pickTargets(body));
  if (body.questions !== undefined) payload.questions = sanitizeQuestions(body.questions);
  return payload;
};

// Summary of a quiz for admin listings (with participation counters)
const adminSummary = (quiz, counts = {}) => {
  const o = quiz.toObject ? quiz.toObject() : quiz;
  const questionCount = (o.questions || []).length;
  return {
    ...o,
    questions: undefined,
    questionCount,
    totalPoints: questionCount * (o.pointsPerQuestion || 1),
    status: quizStatus(o),
    submissions: counts.submitted || 0,
    inProgress: counts.in_progress || 0
  };
};

const announceQuiz = (quiz, event = 'quiz:new') => {
  // Hidden quizzes only trigger a refresh – their details must not leak to students
  const payload = quiz.isActive ? toStudentQuizSummary(quiz) : { _id: quiz._id };
  realtime.emitToMatchingStudents(quiz, quiz.isActive ? event : 'quiz:updated', payload).catch(() => {});
};

// @desc    List quizzes (admin: all with counters, student: their cohort's quizzes)
// @route   GET /api/v1/quizzes
exports.getQuizzes = async (req, res) => {
  if (!isAdmin(req)) {
    const quizzes = await Quiz.find({ isActive: true, ...cohortFilterFor(req.user) })
      .select('-questions.correctAnswer -questions.explanation')
      .sort({ startTime: 1 });
    return res.status(200).json({
      success: true,
      count: quizzes.length,
      data: quizzes.map((q) => toStudentQuizSummary(q))
    });
  }

  const quizzes = await Quiz.find({}).sort({ startTime: -1 }).populate({ path: 'createdBy', select: 'name' });
  const counts = await Result.aggregate([
    { $group: { _id: { quiz: '$quiz', status: '$status' }, n: { $sum: 1 } } }
  ]);
  const byQuiz = {};
  counts.forEach((c) => {
    const id = String(c._id.quiz);
    byQuiz[id] = byQuiz[id] || {};
    byQuiz[id][c._id.status] = c.n;
  });

  res.status(200).json({
    success: true,
    count: quizzes.length,
    data: quizzes.map((q) => adminSummary(q, byQuiz[String(q._id)]))
  });
};

// @desc    Get single quiz. Admin: full document. Student: summary + attempt state (no questions)
// @route   GET /api/v1/quizzes/:id
exports.getQuiz = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));

  if (isAdmin(req)) {
    return res.status(200).json({ success: true, data: quiz });
  }

  const attempt = await Result.findOne({ quiz: quiz._id, user: req.user.id }).select('status score totalPossibleScore submittedAt deadline');
  // Students keep access to quizzes they already attempted (resume / view result)
  if (!attempt && (!quiz.isActive || !matchesCohort(quiz, req.user))) {
    return next(new ErrorResponse('This quiz is not available for your cohort', 404));
  }
  const summary = toStudentQuizSummary(quiz);
  if (quiz.type === 'google_form' && summary.status === 'live') {
    summary.googleFormUrl = quiz.googleFormUrl;
  }

  res.status(200).json({
    success: true,
    data: {
      ...summary,
      attempt: attempt
        ? {
            status: attempt.status,
            resultId: attempt._id,
            score: attempt.status === 'submitted' ? attempt.score : undefined,
            totalPossibleScore: attempt.status === 'submitted' ? attempt.totalPossibleScore : undefined,
            submittedAt: attempt.submittedAt,
            deadline: attempt.deadline
          }
        : null
    },
    serverNow: new Date()
  });
};

const validateQuizBody = (payload, existing) => {
  const merged = { ...(existing ? existing.toObject() : {}), ...payload };
  const targetError = validateTargeting(merged);
  if (targetError) return targetError;
  if (merged.type === 'native' && payload.questions !== undefined && payload.questions.length === 0) {
    return 'Add at least one question to a native quiz';
  }
  if (merged.startTime && merged.endTime && new Date(merged.endTime) <= new Date(merged.startTime)) {
    return 'End time must be after the start time';
  }
  return null;
};

// @desc    Create new quiz (native or external form)
// @route   POST /api/v1/quizzes
exports.createQuiz = async (req, res, next) => {
  const type = req.body.type === 'google_form' ? 'google_form' : 'native';
  const payload = buildQuizPayload(req.body);
  payload.type = type;
  payload.createdBy = req.user.id;
  if (type === 'google_form') {
    payload.questions = [];
    delete payload.timeLimit;
  }
  if (!payload.startTime) payload.startTime = new Date();
  if (!payload.endTime) payload.endTime = new Date(new Date(payload.startTime).getTime() + 7 * 24 * 3600 * 1000);

  const error = validateQuizBody(payload);
  if (error) return next(new ErrorResponse(error, 400));

  const quiz = await Quiz.create(payload);
  if (quiz.isActive) announceQuiz(quiz);
  realtime.emitToAdmins('quizzes:changed', { quizId: String(quiz._id) });

  res.status(201).json({ success: true, data: quiz });
};

// @desc    Update quiz. Questions are locked once students have attempted it.
// @route   PUT /api/v1/quizzes/:id
exports.updateQuiz = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));

  const payload = buildQuizPayload(req.body, { partial: true });
  if (quiz.type === 'google_form') delete payload.questions;

  const changesScoring = payload.questions !== undefined
    || (payload.pointsPerQuestion !== undefined && Number(payload.pointsPerQuestion) !== quiz.pointsPerQuestion);
  if (changesScoring) {
    const attempts = await Result.countDocuments({ quiz: quiz._id });
    if (attempts > 0) {
      return next(new ErrorResponse(
        `Questions and points are locked because ${attempts} student${attempts === 1 ? ' has' : 's have'} already attempted this quiz. Duplicate it to make changes.`,
        409
      ));
    }
  }

  const error = validateQuizBody(payload, quiz);
  if (error) return next(new ErrorResponse(error, 400));

  const wasVisible = quiz.isActive;
  quiz.set(payload);
  if (payload.endTime && new Date(payload.endTime) > new Date()) quiz.forceEndedAt = undefined;
  await quiz.save();

  // Keep running attempts consistent with a changed window
  if (payload.endTime || payload.timeLimit) {
    const running = await Result.find({ quiz: quiz._id, status: 'in_progress' });
    await Promise.all(running.map((r) => {
      const byLimit = new Date(new Date(r.startedAt).getTime() + quiz.timeLimit * 60000);
      r.deadline = new Date(Math.min(byLimit.getTime(), new Date(quiz.endTime).getTime()));
      return r.save();
    }));
    if (running.length) {
      realtime.syncSessionDeadlines(String(quiz._id), running.map((r) => ({ userId: String(r.user), deadline: r.deadline })));
      realtime.emitToQuizRoom(String(quiz._id), 'exam:deadline-changed', {});
    }
  }

  // Hidden → visible is a "new quiz" for students; anything else refreshes their list
  announceQuiz(quiz, !wasVisible && quiz.isActive ? 'quiz:new' : 'quiz:updated');
  realtime.emitToAdmins('quizzes:changed', { quizId: String(quiz._id) });
  res.status(200).json({ success: true, data: quiz });
};

// @desc    Delete quiz and all of its attempts
// @route   DELETE /api/v1/quizzes/:id
exports.deleteQuiz = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));

  const { deletedCount } = await Result.deleteMany({ quiz: quiz._id });
  await quiz.deleteOne();

  realtime.emitToQuizRoom(String(quiz._id), 'exam:cancelled', { message: 'This exam was removed by an administrator.' });
  realtime.endQuizSessions(String(quiz._id));
  realtime.emitToAllStudents('quiz:deleted', { _id: String(quiz._id) });
  realtime.emitToAdmins('quizzes:changed', { quizId: String(quiz._id) });
  realtime.notifyLeaderboardChanged();

  res.status(200).json({ success: true, data: { deletedResults: deletedCount } });
};

// Loads a quiz for a student action. Starting requires the quiz to be visible to the
// student's cohort; saving/submitting an attempt that was already started is always allowed
// (e.g. an admin deactivates the quiz mid-exam – nobody should lose their work).
const loadTakeableQuiz = async (req, { requireAvailable = true } = {}) => {
  if (!isObjectId(req.params.id)) throw new ErrorResponse('Quiz not found', 404);
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ErrorResponse('Quiz not found', 404);
  if (isAdmin(req)) throw new ErrorResponse('Admins can preview quizzes from the console but cannot attempt them', 403);
  if (requireAvailable && (!quiz.isActive || !matchesCohort(quiz, req.user))) {
    throw new ErrorResponse('This quiz is not available for your cohort', 404);
  }
  return quiz;
};

const resultSummary = (result, quiz, evaluation) => {
  const reveal = canRevealAnswers(quiz);
  const answers = result.answers || [];
  const correctCount = evaluation ? evaluation.correctCount : answers.filter((a) => a.isCorrect).length;
  const answeredCount = evaluation ? evaluation.answeredCount : answers.filter((a) => a.selectedOption).length;
  const pct = percentage(result.score, result.totalPossibleScore);
  return {
    resultId: result._id,
    quizId: quiz._id,
    quizTitle: quiz.title,
    quizType: quiz.type,
    status: result.status,
    score: result.score,
    totalPossibleScore: result.totalPossibleScore,
    percentage: pct,
    passed: pct >= (quiz.passPercentage ?? 40),
    passPercentage: quiz.passPercentage ?? 40,
    correctCount,
    incorrectCount: answeredCount - correctCount,
    unansweredCount: (quiz.questions || []).length - answeredCount,
    totalQuestions: (quiz.questions || []).length,
    timeSpentSeconds: result.timeSpentSeconds || 0,
    timeLimit: quiz.timeLimit,
    xpEarned: xpFor(result.score),
    submittedAt: result.submittedAt,
    submissionType: result.submissionType,
    violations: result.tabSwitches || 0,
    reveal,
    revealPolicy: quiz.answerReveal,
    revealAt: quiz.answerReveal === 'after_end' ? revealTime(quiz) : null
  };
};

const buildReview = (result, quiz) => {
  const byId = {};
  (result.answers || []).forEach((a) => { byId[String(a.questionId)] = a; });
  return quiz.questions.map((q, i) => {
    const a = byId[String(q._id)] || {};
    return {
      index: i + 1,
      questionId: q._id,
      questionText: q.questionText,
      options: q.options,
      selectedOption: a.selectedOption || null,
      correctAnswer: q.correctAnswer,
      isCorrect: Boolean(a.isCorrect),
      explanation: q.explanation || '',
      tags: q.tags || [],
      timeSpentSeconds: a.timeSpentSeconds || 0
    };
  });
};

// @desc    Start (or resume) an attempt. Returns questions without answers + server deadline
// @route   POST /api/v1/quizzes/:id/start
exports.startQuiz = async (req, res, next) => {
  // Availability is enforced below only for *new* attempts: a running attempt must stay
  // resumable even if the quiz is hidden mid-exam.
  const quiz = await loadTakeableQuiz(req, { requireAvailable: false });
  if (quiz.type !== 'native') return next(new ErrorResponse('This is an external quiz', 400));

  const now = new Date();
  let attempt = await Result.findOne({ quiz: quiz._id, user: req.user.id });

  if (attempt && attempt.status === 'in_progress' && now.getTime() > new Date(attempt.deadline).getTime() + SUBMISSION_GRACE_MS) {
    await finalizeAttempt(attempt, quiz, { submissionType: 'auto' });
    attempt = await Result.findById(attempt._id);
  }

  if (attempt && attempt.status === 'submitted') {
    return res.status(409).json({
      success: false,
      alreadySubmitted: true,
      resultId: attempt._id,
      error: 'You have already submitted this quiz.'
    });
  }

  if (!attempt) {
    if (!quiz.isActive || !matchesCohort(quiz, req.user)) {
      return next(new ErrorResponse('This quiz is not available for your cohort', 404));
    }
    if (now < quiz.startTime) {
      return next(new ErrorResponse(`This quiz opens at ${quiz.startTime.toISOString()}`, 403));
    }
    if (now > quiz.endTime) return next(new ErrorResponse('This quiz has already closed', 403));

    const byLimit = now.getTime() + quiz.timeLimit * 60 * 1000;
    try {
      attempt = await Result.create({
        user: req.user.id,
        quiz: quiz._id,
        quizType: 'native',
        status: 'in_progress',
        startedAt: now,
        deadline: new Date(Math.min(byLimit, quiz.endTime.getTime())),
        totalPossibleScore: quiz.questions.length * quiz.pointsPerQuestion,
        answers: []
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      attempt = await Result.findOne({ quiz: quiz._id, user: req.user.id }); // concurrent start
    }
  }

  const saved = {};
  const times = {};
  (attempt.answers || []).forEach((a) => {
    if (a.selectedOption) saved[String(a.questionId)] = a.selectedOption;
    if (a.timeSpentSeconds) times[String(a.questionId)] = a.timeSpentSeconds;
  });

  res.status(200).json({
    success: true,
    data: {
      attemptId: attempt._id,
      quiz: {
        _id: quiz._id,
        title: quiz.title,
        description: quiz.description || '',
        timeLimit: quiz.timeLimit,
        pointsPerQuestion: quiz.pointsPerQuestion,
        totalQuestions: quiz.questions.length,
        passPercentage: quiz.passPercentage,
        endTime: quiz.endTime
      },
      questions: questionsForAttempt(quiz, attempt._id),
      answers: saved,
      questionTimes: times,
      violations: attempt.tabSwitches || 0,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      serverNow: new Date()
    }
  });
};

// @desc    Autosave answers for an in-progress attempt (server-side resilience)
// @route   PUT /api/v1/quizzes/:id/progress
exports.saveProgress = async (req, res, next) => {
  const quiz = await loadTakeableQuiz(req, { requireAvailable: false });
  const attempt = await Result.findOne({ quiz: quiz._id, user: req.user.id, status: 'in_progress' });
  if (!attempt) return next(new ErrorResponse('No active attempt for this quiz', 404));

  const now = new Date();
  if (now.getTime() > new Date(attempt.deadline).getTime() + SUBMISSION_GRACE_MS) {
    return next(new ErrorResponse('Time is up for this attempt', 403));
  }

  const answerMap = toAnswerMap(req.body.answers);
  const timeMap = toTimeMap(req.body.questionTimes);
  const valid = new Map(quiz.questions.map((q) => [String(q._id), q]));

  const answers = [];
  valid.forEach((q, id) => {
    const sel = answerMap[id];
    const t = Number(timeMap[id]) || 0;
    const selectedOption = typeof sel === 'string' && q.options.includes(sel) ? sel : null;
    if (selectedOption || t > 0) {
      answers.push({ questionId: q._id, selectedOption, isCorrect: false, timeSpentSeconds: Math.min(Math.round(t), 36000) });
    }
  });

  await Result.updateOne(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { answers, lastSavedAt: now } }
  );

  res.status(200).json({ success: true, data: { savedAt: now, answered: answers.filter((a) => a.selectedOption).length } });
};

// @desc    Submit native quiz & auto evaluate
// @route   POST /api/v1/quizzes/:id/submit
exports.submitQuiz = async (req, res, next) => {
  const quiz = await loadTakeableQuiz(req, { requireAvailable: false });
  if (quiz.type !== 'native') return next(new ErrorResponse('Endpoint only supports native quiz submissions', 400));

  const attempt = await Result.findOne({ quiz: quiz._id, user: req.user.id });
  if (!attempt) return next(new ErrorResponse('Start the quiz before submitting', 400));

  if (attempt.status === 'submitted') {
    return res.status(200).json({
      success: true,
      alreadySubmitted: true,
      data: resultSummary(attempt, quiz)
    });
  }

  const now = new Date();
  const late = now.getTime() > new Date(attempt.deadline).getTime() + SUBMISSION_GRACE_MS;
  // Never trust the client about *why* an attempt ended
  const deadlineMs = new Date(attempt.deadline).getTime();
  const forcedEnd = quiz.forceEndedAt && deadlineMs === new Date(quiz.forceEndedAt).getTime() && now.getTime() >= deadlineMs;
  const requested = forcedEnd ? 'forced' : (now.getTime() >= deadlineMs - 2000 ? 'timeout' : 'manual');

  // Late payloads are ignored – the attempt is scored from the last server-side autosave
  const { result, evaluation, alreadyFinalized } = await finalizeAttempt(attempt, quiz, {
    answerMap: late ? undefined : toAnswerMap(req.body.answers),
    timeMap: late ? undefined : toTimeMap(req.body.questionMetrics || req.body.questionTimes),
    clientViolations: req.body.violations ?? req.body.tabSwitches,
    submissionType: late ? 'auto' : requested,
    extraAudit: late
      ? [{ action: 'late_submission', timestamp: now, details: 'Submission arrived after the deadline; autosaved answers were used' }]
      : []
  });

  if (alreadyFinalized) {
    // Lost a race against a concurrent submit / auto-finalisation – return the stored result
    return res.status(200).json({ success: true, alreadySubmitted: true, data: resultSummary(result, quiz) });
  }
  res.status(201).json({ success: true, data: resultSummary(result, quiz, evaluation) });
};

// @desc    Mark an external (Google/MS Form) quiz as completed
// @route   POST /api/v1/quizzes/:id/complete-external
exports.completeExternal = async (req, res, next) => {
  const quiz = await loadTakeableQuiz(req);
  if (quiz.type !== 'google_form') return next(new ErrorResponse('This is not an external quiz', 400));
  if (quizStatus(quiz) !== 'live') return next(new ErrorResponse('This quiz is not open right now', 403));

  const now = new Date();
  let result = await Result.findOne({ quiz: quiz._id, user: req.user.id });
  if (!result) {
    const opened = Date.parse(req.body.openedAt);
    const startedAt = Number.isFinite(opened) && opened <= now.getTime() && opened >= quiz.startTime.getTime()
      ? new Date(opened)
      : now;
    try {
      result = await Result.create({
        user: req.user.id,
        quiz: quiz._id,
        quizType: 'google_form',
        status: 'submitted',
        startedAt,
        submittedAt: now,
        submissionType: 'external',
        timeSpentSeconds: Math.round((now - startedAt) / 1000),
        score: 0,
        totalPossibleScore: 0
      });
      realtime.emitToAdmins('results:new', {
        quizId: String(quiz._id), quizTitle: quiz.title, resultId: String(result._id),
        userId: String(req.user.id), submissionType: 'external'
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      result = await Result.findOne({ quiz: quiz._id, user: req.user.id });
    }
  }
  res.status(200).json({ success: true, data: { resultId: result._id, submittedAt: result.submittedAt } });
};

// @desc    Student's own result for a quiz (with review when the reveal policy allows it)
// @route   GET /api/v1/quizzes/:id/result
exports.getMyResult = async (req, res, next) => {
  if (!isObjectId(req.params.id)) return next(new ErrorResponse('Quiz not found', 404));
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));

  await finalizeExpiredAttempts({ quiz: quiz._id, user: req.user._id });
  const result = await Result.findOne({ quiz: quiz._id, user: req.user.id });
  if (!result || result.status !== 'submitted') {
    return next(new ErrorResponse('You have not submitted this quiz yet', 404));
  }

  const summary = resultSummary(result, quiz);
  const data = { ...summary };
  if (quiz.type === 'native') {
    data.review = summary.reveal
      ? buildReview(result, quiz)
      : buildReview(result, quiz).map((r) => ({
          index: r.index,
          questionId: r.questionId,
          questionText: r.questionText,
          options: r.options,
          selectedOption: r.selectedOption,
          timeSpentSeconds: r.timeSpentSeconds
        }));
  }
  res.status(200).json({ success: true, data });
};

exports.buildReview = buildReview;
exports.resultSummary = resultSummary;
