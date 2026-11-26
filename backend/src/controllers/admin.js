const { Readable } = require('stream');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const ErrorResponse = require('../utils/errorResponse');
const Result = require('../models/Result');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const QuestionBank = require('../models/QuestionBank');
const Announcement = require('../models/Announcement');
const realtime = require('../realtime');
const quizzes = require('./quizzes');
const { validatePassword } = require('./auth');
const { validateTargeting, validateProfile, getCatalog } = require('../config/academics');
const { finalizeExpiredAttempts } = require('../services/attempts');
const {
  SUBMISSION_GRACE_MS,
  COHORT_FIELDS,
  TARGET_FIELDS,
  pickTargets,
  quizStatus,
  percentage,
  appTimeZone,
  dayKey,
  shiftDayKey
} = require('../utils/quizUtils');

const TIMEZONE = appTimeZone;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageParams = (q, defLimit = 20) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || defLimit, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
};

// Users that a quiz/announcement targets
const audienceFilter = (target) => {
  const filter = { role: 'user', isBanned: { $ne: true } };
  COHORT_FIELDS.forEach((f, i) => {
    const t = target[TARGET_FIELDS[i]];
    if (t && t !== 'All') filter[f] = t;
  });
  return filter;
};

const median = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

const studentLite = (u) => (u
  ? {
      _id: u._id,
      name: u.name,
      email: u.email,
      program: u.program,
      branch: u.branch,
      batchYear: u.batchYear,
      semester: u.semester,
      section: u.section
    }
  : { _id: null, name: 'Deleted user', email: '—' });

// ===================================================================================
// Dashboard
// ===================================================================================

// @desc    Console overview metrics
// @route   GET /api/v1/admin/stats
exports.getStats = async (req, res) => {
  await finalizeExpiredAttempts();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  // Rolling window comfortably covering 14 calendar days in the app timezone
  const since = new Date(now.getTime() - 15 * 24 * 3600 * 1000);

  const [students, verified, newThisWeek, admins, quizList, submissions, flagged, avgAgg, activityAgg, recent] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', isVerified: true }),
    User.countDocuments({ role: 'user', createdAt: { $gte: weekAgo } }),
    User.countDocuments({ role: 'admin' }),
    Quiz.find({}).select('isActive startTime endTime type'),
    Result.countDocuments({ status: 'submitted' }),
    Result.countDocuments({ status: 'submitted', isFlagged: true }),
    Result.aggregate([
      { $match: { status: 'submitted', quizType: { $ne: 'google_form' }, totalPossibleScore: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: { $divide: ['$score', '$totalPossibleScore'] } } } }
    ]),
    Result.aggregate([
      { $match: { status: 'submitted', submittedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: TIMEZONE() } }, n: { $sum: 1 } } }
    ]),
    Result.find({ status: 'submitted' }).sort({ submittedAt: -1 }).limit(8)
      .populate({ path: 'user', select: 'name email' })
      .populate({ path: 'quiz', select: 'title type' })
  ]);

  const statusCounts = { live: 0, scheduled: 0, ended: 0, inactive: 0 };
  quizList.forEach((q) => { statusCounts[quizStatus(q, now)]++; });

  // Fill the 14-day activity series (dates in the configured timezone)
  const byDay = new Map(activityAgg.map((a) => [a._id, a.n]));
  const today = dayKey(now);
  const activity = [];
  for (let i = 13; i >= 0; i--) {
    const key = shiftDayKey(today, -i);
    activity.push({ date: key, submissions: byDay.get(key) || 0 });
  }

  res.status(200).json({
    success: true,
    data: {
      students: { total: students, verified, newThisWeek, online: realtime.onlineStudentCount() },
      admins,
      quizzes: { total: quizList.length, ...statusCounts },
      submissions: {
        total: submissions,
        flagged,
        averagePercentage: avgAgg.length ? Math.round(avgAgg[0].avg * 1000) / 10 : null
      },
      liveTakers: realtime.getLiveTakers().length,
      activity,
      recentSubmissions: recent.map((r) => ({
        resultId: r._id,
        student: r.user ? r.user.name : 'Deleted user',
        email: r.user ? r.user.email : '',
        quizId: r.quiz ? r.quiz._id : null,
        quizTitle: r.quiz ? r.quiz.title : 'Deleted quiz',
        quizType: r.quizType,
        score: r.score,
        totalPossibleScore: r.totalPossibleScore,
        percentage: r.quizType === 'google_form' ? null : percentage(r.score, r.totalPossibleScore),
        isFlagged: r.isFlagged,
        submittedAt: r.submittedAt
      }))
    }
  });
};

// @desc    Live exam sessions snapshot (also pushed over sockets)
// @route   GET /api/v1/admin/live
exports.getLive = async (req, res) => {
  res.status(200).json({ success: true, data: realtime.getLiveTakers() });
};

// ===================================================================================
// Results & analytics
// ===================================================================================

// @desc    Results + analytics for one quiz
// @route   GET /api/v1/admin/quizzes/:id/results
exports.getQuizResults = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));
  await finalizeExpiredAttempts({ quiz: quiz._id });

  const [results, eligible] = await Promise.all([
    Result.find({ quiz: quiz._id }).populate({ path: 'user', select: 'name email program branch batchYear semester section' }),
    User.countDocuments(audienceFilter(quiz))
  ]);

  const submitted = results.filter((r) => r.status === 'submitted');
  const native = quiz.type === 'native';
  const pcts = native ? submitted.map((r) => percentage(r.score, r.totalPossibleScore)) : [];
  const pass = quiz.passPercentage ?? 40;

  const distribution = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, count: 0 }));
  pcts.forEach((p) => { distribution[Math.min(9, Math.floor(p / 10))].count++; });

  let questionStats = [];
  if (native) {
    questionStats = quiz.questions.map((q, i) => {
      const optionCounts = Object.fromEntries(q.options.map((o) => [o, 0]));
      let answered = 0;
      let correct = 0;
      let timeTotal = 0;
      submitted.forEach((r) => {
        const a = (r.answers || []).find((x) => String(x.questionId) === String(q._id));
        if (!a) return;
        timeTotal += a.timeSpentSeconds || 0;
        if (a.selectedOption) {
          answered++;
          if (optionCounts[a.selectedOption] !== undefined) optionCounts[a.selectedOption]++;
          if (a.isCorrect) correct++;
        }
      });
      const wrong = Object.entries(optionCounts)
        .filter(([o]) => o !== q.correctAnswer)
        .sort((a, b) => b[1] - a[1])[0];
      return {
        index: i + 1,
        questionId: q._id,
        questionText: q.questionText,
        correctAnswer: q.correctAnswer,
        options: q.options,
        optionCounts,
        answered,
        correct,
        correctRate: submitted.length ? percentage(correct, submitted.length) : null,
        avgTimeSeconds: submitted.length ? Math.round(timeTotal / submitted.length) : null,
        mostCommonWrong: wrong && wrong[1] > 0 ? { option: wrong[0], count: wrong[1] } : null
      };
    });
  }

  const times = submitted.map((r) => r.timeSpentSeconds || 0).filter((t) => t > 0);
  res.status(200).json({
    success: true,
    data: {
      quiz: {
        _id: quiz._id,
        title: quiz.title,
        type: quiz.type,
        status: quizStatus(quiz),
        startTime: quiz.startTime,
        endTime: quiz.endTime,
        timeLimit: quiz.timeLimit,
        questionCount: quiz.questions.length,
        totalPoints: quiz.questions.length * quiz.pointsPerQuestion,
        passPercentage: pass,
        ...pickTargets(quiz)
      },
      summary: {
        eligible,
        submissions: submitted.length,
        inProgress: results.length - submitted.length,
        participationRate: eligible ? percentage(submitted.length, eligible) : null,
        averagePercentage: pcts.length ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10 : null,
        highest: pcts.length ? Math.max(...pcts) : null,
        lowest: pcts.length ? Math.min(...pcts) : null,
        median: median(pcts),
        passRate: pcts.length ? percentage(pcts.filter((p) => p >= pass).length, pcts.length) : null,
        flagged: submitted.filter((r) => r.isFlagged).length,
        avgTimeSeconds: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null
      },
      distribution: native ? distribution : [],
      questionStats,
      results: results
        .map((r) => ({
          resultId: r._id,
          student: studentLite(r.user),
          status: r.status,
          score: r.score,
          totalPossibleScore: r.totalPossibleScore,
          percentage: native && r.status === 'submitted' ? percentage(r.score, r.totalPossibleScore) : null,
          passed: native && r.status === 'submitted' ? percentage(r.score, r.totalPossibleScore) >= pass : null,
          timeSpentSeconds: r.timeSpentSeconds || 0,
          violations: r.tabSwitches || 0,
          isFlagged: r.isFlagged,
          flagReasons: r.flagReasons || [],
          submissionType: r.submissionType,
          startedAt: r.startedAt,
          deadline: r.deadline,
          submittedAt: r.submittedAt
        }))
        .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1))
    }
  });
};

// @desc    Full detail of one attempt (answers + proctoring audit log)
// @route   GET /api/v1/admin/results/:id
exports.getAttempt = async (req, res, next) => {
  const result = await Result.findById(req.params.id)
    .populate({ path: 'user', select: 'name email program branch batchYear semester section' });
  if (!result) return next(new ErrorResponse('Attempt not found', 404));
  const quiz = await Quiz.findById(result.quiz);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));

  res.status(200).json({
    success: true,
    data: {
      resultId: result._id,
      quiz: { _id: quiz._id, title: quiz.title, type: quiz.type, passPercentage: quiz.passPercentage },
      student: studentLite(result.user),
      status: result.status,
      score: result.score,
      totalPossibleScore: result.totalPossibleScore,
      percentage: percentage(result.score, result.totalPossibleScore),
      timeSpentSeconds: result.timeSpentSeconds || 0,
      violations: result.tabSwitches || 0,
      isFlagged: result.isFlagged,
      flagReasons: result.flagReasons || [],
      submissionType: result.submissionType,
      startedAt: result.startedAt,
      deadline: result.deadline,
      submittedAt: result.submittedAt,
      auditLog: (result.auditLog || []).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
      review: quiz.type === 'native' ? quizzes.buildReview(result, quiz) : []
    }
  });
};

// @desc    Delete an attempt so the student can retake the quiz
// @route   DELETE /api/v1/admin/results/:id
exports.resetAttempt = async (req, res, next) => {
  const result = await Result.findById(req.params.id);
  if (!result) return next(new ErrorResponse('Attempt not found', 404));
  await result.deleteOne();
  if (result.status === 'submitted' && result.score) {
    await User.updateOne({ _id: result.user }, { $inc: { totalScore: -result.score } });
  }
  realtime.endLiveSession(String(result.user), String(result.quiz));
  realtime.emitToUser(String(result.user), 'exam:cancelled', {
    quizId: String(result.quiz),
    message: 'An administrator reset your attempt. You can start the quiz again.'
  });
  realtime.emitToUser(String(result.user), 'quiz:updated', { _id: String(result.quiz) });
  realtime.notifyLeaderboardChanged();
  res.status(200).json({ success: true, data: {} });
};

// @desc    Force-end a live quiz: closes the window and auto-submits every running attempt
// @route   POST /api/v1/admin/quizzes/:id/force-end
exports.forceEndQuiz = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));
  if (quizStatus(quiz) !== 'live') return next(new ErrorResponse('Only live quizzes can be force-ended', 400));

  const now = new Date();
  quiz.endTime = now > quiz.startTime ? now : new Date(quiz.startTime.getTime() + 1000);
  quiz.forceEndedAt = quiz.endTime;
  await quiz.save();

  const { modifiedCount } = await Result.updateMany(
    { quiz: quiz._id, status: 'in_progress' },
    { $set: { deadline: quiz.forceEndedAt } }
  );

  realtime.emitToQuizRoom(String(quiz._id), 'exam:force-submit', {
    quizId: String(quiz._id),
    message: 'An administrator has ended this exam. Your answers are being submitted.'
  });
  realtime.emitToAllStudents('quiz:updated', { _id: String(quiz._id) });
  realtime.emitToAdmins('quizzes:changed', { quizId: String(quiz._id) });

  // Anyone who did not submit within the grace window is finalised from autosaved answers
  setTimeout(() => {
    finalizeExpiredAttempts({ quiz: quiz._id }).catch((err) => console.error('[FORCE-END]', err.message));
  }, SUBMISSION_GRACE_MS + 2000).unref();

  res.status(200).json({ success: true, data: { runningAttempts: modifiedCount, endedAt: quiz.endTime } });
};

const csvSafe = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
};

// @desc    Export quiz results to CSV
// @route   GET /api/v1/admin/results/:quizId/csv
exports.exportResultsCsv = async (req, res, next) => {
  const quiz = await Quiz.findById(req.params.quizId);
  if (!quiz) return next(new ErrorResponse('Quiz not found', 404));
  await finalizeExpiredAttempts({ quiz: quiz._id });

  const results = await Result.find({ quiz: quiz._id, status: 'submitted' })
    .sort({ score: -1, submittedAt: 1 })
    .populate({ path: 'user', select: 'name email program branch batchYear semester section' });

  if (!results.length) {
    return next(new ErrorResponse('No submissions yet for this quiz', 404));
  }

  const native = quiz.type === 'native';
  const pass = quiz.passPercentage ?? 40;
  const rows = results.map((r, i) => {
    const u = r.user || {};
    const pct = percentage(r.score, r.totalPossibleScore);
    const row = {
      Rank: i + 1,
      Student_Name: csvSafe(u.name || 'Deleted user'),
      Student_Email: csvSafe(u.email || ''),
      Program: csvSafe(u.program),
      Branch: csvSafe(u.branch),
      Batch: csvSafe(u.batchYear),
      Semester: csvSafe(u.semester),
      Section: csvSafe(u.section)
    };
    if (native) {
      Object.assign(row, {
        Score: r.score,
        Total_Possible: r.totalPossibleScore,
        Percentage: `${pct}%`,
        Result: pct >= pass ? 'PASS' : 'FAIL',
        Correct: (r.answers || []).filter((a) => a.isCorrect).length,
        Unanswered: quiz.questions.length - (r.answers || []).filter((a) => a.selectedOption).length,
        Time_Spent_Seconds: r.timeSpentSeconds || 0,
        Proctoring_Violations: r.tabSwitches || 0,
        Audit_Events: (r.auditLog || []).length,
        Flagged: r.isFlagged ? 'YES' : 'NO',
        Flag_Reasons: csvSafe((r.flagReasons || []).join('; ')),
        Submission_Type: r.submissionType
      });
    }
    row.Started_At = r.startedAt ? r.startedAt.toISOString() : '';
    row.Submitted_At = r.submittedAt ? r.submittedAt.toISOString() : '';
    return row;
  });

  const parser = new Parser({ fields: Object.keys(rows[0]) });
  const filename = `${quiz.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'quiz'}_Results.csv`;
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.attachment(filename);
  res.send(`\uFEFF${parser.parse(rows)}`); // BOM so Excel detects UTF-8
};

// ===================================================================================
// Quizzes
// ===================================================================================

// @desc    Create embeddable external quiz (Google/MS Form)
// @route   POST /api/v1/admin/quizzes/external
exports.createExternalQuiz = async (req, res, next) => {
  const { title, googleFormUrl, scheduledTime, endTime, description } = req.body;
  const start = scheduledTime && !Number.isNaN(Date.parse(scheduledTime)) ? new Date(scheduledTime) : new Date();
  const end = endTime && !Number.isNaN(Date.parse(endTime))
    ? new Date(endTime)
    : new Date(start.getTime() + 24 * 3600 * 1000);
  req.body = {
    ...pickTargets(req.body),
    title,
    description,
    googleFormUrl,
    type: 'google_form',
    startTime: start,
    endTime: end,
    passPercentage: 0
  };
  return quizzes.createQuiz(req, res, next);
};

// ===================================================================================
// Question bank
// ===================================================================================

const normHeader = ({ header }) => String(header).replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const HEADER_ALIASES = {
  question: ['questiontext', 'question', 'text'],
  correct: ['correctanswer', 'answer', 'correct', 'correctoption'],
  explanation: ['explanation', 'reason', 'solution'],
  tags: ['tags', 'tag', 'topic', 'topics', 'subject']
};

const pickCol = (row, aliases) => {
  for (const a of aliases) if (row[a] !== undefined && String(row[a]).trim() !== '') return String(row[a]).trim();
  return '';
};

const parseQuestionCsv = (buffer) => new Promise((resolve, reject) => {
  const rows = [];
  Readable.from(buffer)
    .pipe(csv({ mapHeaders: normHeader }))
    .on('data', (r) => { if (rows.length < 2000) rows.push(r); })
    .on('end', () => resolve(rows))
    .on('error', reject);
});

const rowToQuestion = (row) => {
  const questionText = pickCol(row, HEADER_ALIASES.question);
  const options = [];
  for (let i = 1; i <= 6; i++) {
    const letter = String.fromCharCode(96 + i); // a..f
    const v = pickCol(row, [`option${i}`, `option${letter}`, letter, `opt${i}`]);
    if (v) options.push(v);
  }
  const rawCorrect = pickCol(row, HEADER_ALIASES.correct);

  if (!questionText) return { error: 'Missing question text' };
  if (options.length < 2) return { error: 'Needs at least 2 options' };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: 'Duplicate options' };
  if (!rawCorrect) return { error: 'Missing correct answer' };

  let correctAnswer = options.find((o) => o.toLowerCase() === rawCorrect.toLowerCase());
  if (!correctAnswer && /^[a-f]$/i.test(rawCorrect)) correctAnswer = options[rawCorrect.toLowerCase().charCodeAt(0) - 97];
  if (!correctAnswer && /^[1-6]$/.test(rawCorrect)) correctAnswer = options[Number(rawCorrect) - 1];
  if (!correctAnswer) return { error: `Correct answer "${rawCorrect}" does not match any option` };

  const tags = pickCol(row, HEADER_ALIASES.tags)
    .split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10);

  return {
    question: {
      questionText: questionText.slice(0, 2000),
      options,
      correctAnswer,
      explanation: pickCol(row, HEADER_ALIASES.explanation).slice(0, 2000),
      tags
    }
  };
};

// @desc    Bulk import questions from CSV (optionally just parse them for the quiz builder)
// @route   POST /api/v1/admin/questions/bulk?saveToBank=true|false
exports.bulkImportQuestions = async (req, res, next) => {
  if (!req.file) return next(new ErrorResponse('Please upload a CSV file', 400));

  let rows;
  try {
    rows = await parseQuestionCsv(req.file.buffer);
  } catch (err) {
    return next(new ErrorResponse('Could not read the CSV file. Please check its format.', 400));
  }
  if (!rows.length) return next(new ErrorResponse('The CSV file is empty', 400));

  const parsed = [];
  const skipped = [];
  rows.forEach((row, i) => {
    const { question, error } = rowToQuestion(row);
    if (error) skipped.push({ row: i + 2, reason: error });
    else parsed.push(question);
  });

  if (!parsed.length) {
    return next(new ErrorResponse(
      'No valid questions found. Expected columns: QuestionText, Option1…Option6, CorrectAnswer, Explanation, Tags',
      400,
      { skipped: skipped.slice(0, 50) }
    ));
  }

  const saveToBank = req.query.saveToBank !== 'false';
  let imported = 0;
  if (saveToBank) {
    const inserted = await QuestionBank.insertMany(parsed.map((q) => ({ ...q, createdBy: req.user.id })), { ordered: false });
    imported = inserted.length;
  }

  res.status(201).json({
    success: true,
    message: saveToBank
      ? `Imported ${imported} question${imported === 1 ? '' : 's'} into the bank${skipped.length ? ` (${skipped.length} skipped)` : ''}.`
      : `Parsed ${parsed.length} question${parsed.length === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} skipped)` : ''}.`,
    count: saveToBank ? imported : parsed.length,
    skipped: skipped.slice(0, 50),
    questions: parsed
  });
};

// @desc    Browse/search the question bank
// @route   GET /api/v1/admin/questions
exports.listQuestions = async (req, res) => {
  const { limit, page, skip } = pageParams(req.query, 20);
  const filter = {};
  if (req.query.search) filter.questionText = { $regex: escapeRegex(String(req.query.search).slice(0, 100)), $options: 'i' };
  if (req.query.tag) filter.tags = String(req.query.tag).toLowerCase();

  const [data, total, tags] = await Promise.all([
    QuestionBank.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    QuestionBank.countDocuments(filter),
    QuestionBank.distinct('tags')
  ]);
  res.status(200).json({ success: true, data, total, page, pages: Math.max(1, Math.ceil(total / limit)), tags: tags.sort() });
};

// @desc    Add a question to the bank
// @route   POST /api/v1/admin/questions
exports.createQuestion = async (req, res) => {
  const { questionText, options, correctAnswer, explanation, tags } = req.body;
  const q = await QuestionBank.create({
    questionText,
    options: Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : options,
    correctAnswer: typeof correctAnswer === 'string' ? correctAnswer.trim() : correctAnswer,
    explanation,
    tags: Array.isArray(tags) ? tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    createdBy: req.user.id
  });
  res.status(201).json({ success: true, data: q });
};

// @desc    Delete a bank question
// @route   DELETE /api/v1/admin/questions/:id
exports.deleteQuestion = async (req, res, next) => {
  const q = await QuestionBank.findByIdAndDelete(req.params.id);
  if (!q) return next(new ErrorResponse('Question not found', 404));
  res.status(200).json({ success: true, data: {} });
};

// ===================================================================================
// Users
// ===================================================================================

// @desc    List/search users with participation stats
// @route   GET /api/v1/admin/users
exports.listUsers = async (req, res) => {
  const { limit, page, skip } = pageParams(req.query, 20);
  const filter = {};
  if (req.query.role === 'admin') filter.role = 'admin';
  else if (req.query.role !== 'all') filter.role = 'user';
  if (req.query.search) {
    const rx = { $regex: escapeRegex(String(req.query.search).slice(0, 100)), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  if (req.query.status === 'banned') filter.isBanned = true;
  if (req.query.status === 'unverified') filter.isVerified = false;
  if (req.query.status === 'active') { filter.isBanned = { $ne: true }; filter.isVerified = true; }
  if (req.query.program) filter.program = String(req.query.program);

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);

  const stats = await Result.aggregate([
    { $match: { user: { $in: users.map((u) => u._id) }, status: 'submitted' } },
    {
      $group: {
        _id: '$user',
        attempts: { $sum: 1 },
        points: { $sum: '$score' },
        possible: { $sum: '$totalPossibleScore' },
        flagged: { $sum: { $cond: ['$isFlagged', 1, 0] } },
        lastAt: { $max: '$submittedAt' }
      }
    }
  ]);
  const byUser = new Map(stats.map((s) => [String(s._id), s]));

  res.status(200).json({
    success: true,
    data: users.map((u) => {
      const s = byUser.get(String(u._id));
      return {
        ...u.toPublic(),
        attempts: s ? s.attempts : 0,
        avgPercentage: s && s.possible ? percentage(s.points, s.possible) : null,
        flagged: s ? s.flagged : 0,
        lastSubmissionAt: s ? s.lastAt : null,
        isSelf: String(u._id) === String(req.user._id)
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit))
  });
};

// @desc    Ban/unban or manually verify a user
// @route   PATCH /api/v1/admin/users/:id
exports.updateUser = async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id)) {
    return next(new ErrorResponse('You cannot change your own account status here', 400));
  }
  const user = await User.findById(req.params.id);
  if (!user) return next(new ErrorResponse('User not found', 404));

  if (typeof req.body.isBanned === 'boolean') user.isBanned = req.body.isBanned;
  if (req.body.isVerified === true) user.isVerified = true;

  // Correct a student's academic identity (students can't change it themselves once set)
  if (req.body.profile && typeof req.body.profile === 'object') {
    if (user.role === 'admin') return next(new ErrorResponse('Administrators have no academic profile', 400));
    const pick = (k) => (typeof req.body.profile[k] === 'string' ? req.body.profile[k].trim() : '');
    const profile = { program: pick('program'), branch: pick('branch'), batchYear: pick('batchYear'), semester: pick('semester'), section: pick('section') };
    const error = validateProfile(profile);
    if (error) return next(new ErrorResponse(error, 400));
    Object.assign(user, profile);
  }
  await user.save({ validateBeforeSave: false });

  if (user.isBanned) realtime.disconnectUser(String(user._id)).catch(() => {});
  else realtime.refreshUserSockets(user).catch(() => {});
  realtime.notifyLeaderboardChanged();
  res.status(200).json({ success: true, data: user.toPublic() });
};

// @desc    Move a whole batch to a new semester (term progression)
// @route   POST /api/v1/admin/users/promote
exports.promoteBatch = async (req, res, next) => {
  const pick = (k) => (typeof req.body[k] === 'string' ? req.body[k].trim() : '');
  const program = pick('program');
  const batchYear = pick('batchYear');
  const semester = pick('semester');
  const branch = pick('branch');
  if (!program || !batchYear || !semester) return next(new ErrorResponse('Program, batch and the new semester are required', 400));
  const p = getCatalog().programs[program];
  if (!p) return next(new ErrorResponse('Invalid program', 400));
  if (branch && branch !== 'All' && !p.branches.includes(branch)) return next(new ErrorResponse(`Invalid branch for ${program}`, 400));
  if (!/^\d{4}-\d{4}$/.test(batchYear)) return next(new ErrorResponse('Invalid batch', 400));
  if (!p.semesters.includes(semester)) return next(new ErrorResponse(`Invalid semester for ${program}`, 400));

  const filter = { role: 'user', program, batchYear };
  if (branch && branch !== 'All') filter.branch = branch;
  const { modifiedCount } = await User.updateMany(filter, { $set: { semester } });
  res.status(200).json({ success: true, data: { updated: modifiedCount } });
};

// @desc    Delete a user and their attempts
// @route   DELETE /api/v1/admin/users/:id
exports.deleteUser = async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id)) {
    return next(new ErrorResponse('You cannot delete your own account', 400));
  }
  const user = await User.findById(req.params.id);
  if (!user) return next(new ErrorResponse('User not found', 404));
  if (user.role === 'admin') {
    const admins = await User.countDocuments({ role: 'admin' });
    if (admins <= 1) return next(new ErrorResponse('At least one administrator account must remain', 400));
  }
  const { deletedCount } = await Result.deleteMany({ user: user._id });
  await user.deleteOne();
  realtime.disconnectUser(String(user._id)).catch(() => {});
  realtime.notifyLeaderboardChanged();
  res.status(200).json({ success: true, data: { deletedResults: deletedCount } });
};

// @desc    Create another administrator
// @route   POST /api/v1/admin/admins
exports.createAdmin = async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' && req.body.email.length <= 254 ? req.body.email.trim().toLowerCase() : '';
  if (!name || !email) return next(new ErrorResponse('Name and a valid email are required', 400));
  const pwError = validatePassword(req.body.password);
  if (pwError) return next(new ErrorResponse(pwError, 400));
  const admin = await User.create({ name, email, password: req.body.password, role: 'admin', isVerified: true });
  res.status(201).json({ success: true, data: admin.toPublic() });
};

// ===================================================================================
// Announcements
// ===================================================================================

// @desc    Broadcast an announcement (persisted + pushed live to matching students)
// @route   POST /api/v1/admin/announcements
exports.createAnnouncement = async (req, res, next) => {
  const targets = pickTargets(req.body);
  const targetError = validateTargeting(targets);
  if (targetError) return next(new ErrorResponse(targetError, 400));

  const announcement = await Announcement.create({
    title: typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Announcement',
    message: req.body.message,
    priority: ['info', 'important', 'urgent'].includes(req.body.priority) ? req.body.priority : 'info',
    ...targets,
    createdBy: req.user.id
  });

  const payload = {
    _id: announcement._id,
    title: announcement.title,
    message: announcement.message,
    priority: announcement.priority,
    createdAt: announcement.createdAt,
    author: req.user.name
  };
  const reached = await realtime.emitToMatchingStudents(announcement, 'announcement', payload);

  res.status(201).json({ success: true, data: { ...announcement.toObject(), reachedOnline: reached } });
};

// @desc    Announcement history
// @route   GET /api/v1/admin/announcements
exports.listAnnouncements = async (req, res) => {
  const list = await Announcement.find({}).sort({ createdAt: -1 }).limit(50).populate({ path: 'createdBy', select: 'name' });
  res.status(200).json({ success: true, data: list });
};

// @desc    Delete an announcement
// @route   DELETE /api/v1/admin/announcements/:id
exports.deleteAnnouncement = async (req, res, next) => {
  const a = await Announcement.findByIdAndDelete(req.params.id);
  if (!a) return next(new ErrorResponse('Announcement not found', 404));
  res.status(200).json({ success: true, data: {} });
};
