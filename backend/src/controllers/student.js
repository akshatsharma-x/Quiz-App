const ErrorResponse = require('../utils/errorResponse');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const Announcement = require('../models/Announcement');
const realtime = require('../realtime');
const { validateProfile } = require('../config/academics');
const { computeLeaderboard, SCOPES } = require('../services/leaderboard');
const { finalizeExpiredAttempts } = require('../services/attempts');
const {
  XP_PER_POINT,
  cohortFilterFor,
  toStudentQuizSummary,
  canRevealAnswers,
  getTier,
  computeStreak,
  percentage
} = require('../utils/quizUtils');

const requireStudentProfile = (req) => {
  if (req.user.role === 'admin') throw new ErrorResponse('This endpoint is for students', 403);
};

const historyRow = (r) => {
  const quiz = r.quiz;
  const native = r.quizType !== 'google_form';
  const pct = native ? percentage(r.score, r.totalPossibleScore) : null;
  return {
    resultId: r._id,
    quizId: quiz ? quiz._id : null,
    quizTitle: quiz ? quiz.title : 'Deleted quiz',
    quizType: r.quizType || 'native',
    submittedAt: r.submittedAt,
    score: native ? r.score : null,
    totalPossibleScore: native ? r.totalPossibleScore : null,
    percentage: pct,
    passed: native ? pct >= ((quiz && quiz.passPercentage) ?? 40) : null,
    timeSpentSeconds: r.timeSpentSeconds || 0,
    violations: r.tabSwitches || 0,
    submissionType: r.submissionType,
    xpEarned: native ? r.score * XP_PER_POINT : 0,
    reveal: quiz ? canRevealAnswers(quiz) : false
  };
};

const loadHistory = async (userId) => {
  await finalizeExpiredAttempts({ user: userId });
  const results = await Result.find({ user: userId, status: 'submitted' })
    .sort({ submittedAt: -1 })
    .populate({ path: 'quiz', select: 'title passPercentage answerReveal endTime type' });
  return results.map(historyRow);
};

// @desc    Quizzes for the logged-in student's cohort, annotated with attempt state
// @route   GET /api/v1/student/my-quizzes
exports.getSmartQuizzes = async (req, res) => {
  requireStudentProfile(req);
  const student = req.user;

  if (!student.hasCompleteProfile()) {
    return res.status(200).json({
      success: true,
      profileIncomplete: true,
      message: 'Student profile incomplete. Please complete profile setup.',
      data: []
    });
  }

  const now = new Date();
  const quizzes = await Quiz.find({
    isActive: true,
    endTime: { $gt: now },
    ...cohortFilterFor(student)
  })
    .select('-questions.correctAnswer -questions.explanation -questions.options')
    .sort({ startTime: 1 });

  const attempts = await Result.find({ user: student._id, quiz: { $in: quizzes.map((q) => q._id) } })
    .select('quiz status score totalPossibleScore submittedAt deadline');
  const byQuiz = new Map(attempts.map((a) => [String(a.quiz), a]));

  const data = quizzes.map((q) => {
    const a = byQuiz.get(String(q._id));
    return {
      ...toStudentQuizSummary(q, now),
      attempt: a
        ? {
            status: a.status,
            resultId: a._id,
            score: a.status === 'submitted' ? a.score : undefined,
            totalPossibleScore: a.status === 'submitted' ? a.totalPossibleScore : undefined,
            percentage: a.status === 'submitted' && a.totalPossibleScore ? percentage(a.score, a.totalPossibleScore) : undefined,
            deadline: a.deadline,
            submittedAt: a.submittedAt
          }
        : null
    };
  });

  res.status(200).json({
    success: true,
    count: data.length,
    serverNow: now,
    studentCohort: {
      program: student.program,
      branch: student.branch,
      batchYear: student.batchYear,
      semester: student.semester,
      section: student.section
    },
    data
  });
};

// @desc    Set the academic identity (once) and/or update the display name.
//          Cohort decides which quizzes a student may take, so after the first setup it is
//          locked for students and can only be changed by an administrator.
// @route   PUT /api/v1/student/profile
exports.updateStudentProfile = async (req, res, next) => {
  requireStudentProfile(req);
  const pick = (k) => (typeof req.body[k] === 'string' ? req.body[k].trim() : '');
  const profile = {
    program: pick('program'),
    branch: pick('branch'),
    batchYear: pick('batchYear'),
    semester: pick('semester'),
    section: pick('section')
  };
  const wantsCohortChange = Object.values(profile).some(Boolean);
  const locked = req.user.hasCompleteProfile();

  if (wantsCohortChange) {
    const unchanged = Object.entries(profile).every(([k, v]) => !v || v === req.user[k]);
    if (locked && !unchanged) {
      return next(new ErrorResponse('Your academic profile is locked. Ask a faculty administrator to correct it.', 403));
    }
    if (!locked) {
      const error = validateProfile(profile);
      if (error) return next(new ErrorResponse(error, 400));
      Object.assign(req.user, profile);
    }
  } else if (!locked) {
    return next(new ErrorResponse('Please complete your academic profile', 400));
  }

  const name = pick('name');
  if (name) {
    if (name.length > 80) return next(new ErrorResponse('Name cannot be more than 80 characters', 400));
    req.user.name = name;
  }
  await req.user.save({ validateBeforeSave: false });
  realtime.refreshUserSockets(req.user).catch(() => {});

  res.status(200).json({ success: true, data: req.user.toPublic() });
};

// @desc    Dashboard overview: XP, rank, streak, averages, recent results
// @route   GET /api/v1/student/overview
exports.getOverview = async (req, res) => {
  requireStudentProfile(req);
  const me = req.user;
  const history = await loadHistory(me._id);
  const native = history.filter((h) => h.quizType !== 'google_form');

  const points = native.reduce((s, h) => s + (h.score || 0), 0);
  const xp = points * XP_PER_POINT;
  const board = await computeLeaderboard({ scope: 'global' });
  const mine = board.find((r) => r.userId === String(me._id));

  const unread = await Announcement.countDocuments({
    ...cohortFilterFor(me),
    ...(me.lastSeenAnnouncementsAt ? { createdAt: { $gt: me.lastSeenAnnouncementsAt } } : {})
  });

  res.status(200).json({
    success: true,
    data: {
      user: me.toPublic(),
      stats: {
        xp,
        tier: getTier(xp),
        rank: mine ? mine.rank : null,
        rankedStudents: board.length,
        quizzesTaken: history.length,
        avgPercentage: native.length
          ? Math.round((native.reduce((s, h) => s + h.percentage, 0) / native.length) * 10) / 10
          : null,
        bestPercentage: native.length ? Math.max(...native.map((h) => h.percentage)) : null,
        passed: native.filter((h) => h.passed).length,
        streak: computeStreak(history.map((h) => h.submittedAt))
      },
      recentResults: history.slice(0, 5),
      unreadAnnouncements: unread
    }
  });
};

// @desc    Full attempt history
// @route   GET /api/v1/student/results
exports.getMyResults = async (req, res) => {
  requireStudentProfile(req);
  const history = await loadHistory(req.user._id);
  res.status(200).json({ success: true, count: history.length, data: history });
};

// @desc    Deep analytics: proficiency by topic, trend and actionable feedback
// @route   GET /api/v1/student/analytics
exports.getAnalytics = async (req, res) => {
  requireStudentProfile(req);
  const me = req.user;
  await finalizeExpiredAttempts({ user: me._id });

  const results = await Result.find({ user: me._id, status: 'submitted', quizType: { $ne: 'google_form' } })
    .sort({ submittedAt: 1 })
    .populate({ path: 'quiz', select: 'title questions passPercentage answerReveal endTime type' });

  const live = results.filter((r) => r.quiz);
  const tagStats = new Map();
  const quizStats = [];
  let lockedNewer = 0;
  let latestFeedback = null;

  live.forEach((r) => {
    const quiz = r.quiz;
    const reveal = canRevealAnswers(quiz);
    const qById = new Map(quiz.questions.map((q) => [String(q._id), q]));
    quizStats.push({ label: quiz.title, accuracy: percentage(r.score, r.totalPossibleScore) });
    if (!reveal) {
      lockedNewer++;
      return;
    }
    lockedNewer = 0;
    (r.answers || []).forEach((a) => {
      const q = qById.get(String(a.questionId));
      if (!q) return;
      (q.tags && q.tags.length ? q.tags : []).forEach((tag) => {
        const s = tagStats.get(tag) || { label: tag, correct: 0, total: 0 };
        s.total++;
        if (a.isCorrect) s.correct++;
        tagStats.set(tag, s);
      });
    });
    const mistakes = (r.answers || [])
      .filter((a) => !a.isCorrect)
      .map((a) => {
        const q = qById.get(String(a.questionId));
        return q && {
          questionText: q.questionText,
          selectedOption: a.selectedOption,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation || ''
        };
      })
      .filter(Boolean);
    latestFeedback = {
      quizId: quiz._id,
      quizTitle: quiz.title,
      submittedAt: r.submittedAt,
      percentage: percentage(r.score, r.totalPossibleScore),
      mistakes
    };
  });

  let proficiency = Array.from(tagStats.values())
    .filter((s) => s.total > 0)
    .map((s) => ({ label: s.label, correct: s.correct, total: s.total, accuracy: percentage(s.correct, s.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  let proficiencyMode = 'tags';
  if (proficiency.length < 3) {
    // Not enough tagged questions – fall back to per-quiz accuracy (latest 8 quizzes)
    proficiency = quizStats.slice(-8).map((q) => ({ label: q.label, accuracy: q.accuracy }));
    proficiencyMode = 'quizzes';
  }

  const pcts = live.map((r) => percentage(r.score, r.totalPossibleScore));
  res.status(200).json({
    success: true,
    data: {
      summary: {
        attempts: live.length,
        avgPercentage: pcts.length ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10 : null,
        bestPercentage: pcts.length ? Math.max(...pcts) : null,
        totalTimeSeconds: live.reduce((s, r) => s + (r.timeSpentSeconds || 0), 0),
        xp: live.reduce((s, r) => s + r.score, 0) * XP_PER_POINT
      },
      trend: live.slice(-12).map((r) => ({
        quizTitle: r.quiz.title,
        submittedAt: r.submittedAt,
        percentage: percentage(r.score, r.totalPossibleScore)
      })),
      proficiency,
      proficiencyMode,
      latestFeedback,
      pendingReveal: lockedNewer
    }
  });
};

// @desc    Leaderboard (global / my batch / my section)
// @route   GET /api/v1/student/leaderboard
exports.getLeaderboard = async (req, res) => {
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'global';
  const me = req.user.role === 'admin' ? null : req.user;
  const effectiveScope = me && !me.hasCompleteProfile() ? 'global' : scope;
  const board = await computeLeaderboard({ scope: effectiveScope, me });
  const mine = me ? board.find((r) => r.userId === String(me._id)) : null;

  res.status(200).json({
    success: true,
    data: {
      scope: effectiveScope,
      totalRanked: board.length,
      entries: board.slice(0, 10).map((r) => ({ ...r, isMe: Boolean(me) && r.userId === String(me._id) })),
      me: me
        ? mine || { rank: null, name: me.name, xp: 0, points: 0, quizzes: 0, avgPercentage: null, tier: getTier(0), program: me.program, branch: me.branch }
        : null
    }
  });
};

// @desc    Announcements targeted at the student (newest first) + unread counter
// @route   GET /api/v1/student/announcements
exports.getAnnouncements = async (req, res) => {
  requireStudentProfile(req);
  const me = req.user;
  const list = await Announcement.find(cohortFilterFor(me)).sort({ createdAt: -1 }).limit(25)
    .populate({ path: 'createdBy', select: 'name' });
  const seen = me.lastSeenAnnouncementsAt ? new Date(me.lastSeenAnnouncementsAt) : null;
  res.status(200).json({
    success: true,
    data: list.map((a) => ({
      _id: a._id,
      title: a.title,
      message: a.message,
      priority: a.priority,
      createdAt: a.createdAt,
      author: a.createdBy ? a.createdBy.name : 'Administrator',
      unread: !seen || a.createdAt > seen
    })),
    unread: list.filter((a) => !seen || a.createdAt > seen).length
  });
};

// @desc    Mark announcements as read
// @route   POST /api/v1/student/announcements/seen
exports.markAnnouncementsSeen = async (req, res) => {
  requireStudentProfile(req);
  req.user.lastSeenAnnouncementsAt = new Date();
  await req.user.save({ validateBeforeSave: false });
  res.status(200).json({ success: true });
};
