const Result = require('../models/Result');
const Quiz = require('../models/Quiz');
const User = require('../models/User');
const realtime = require('../realtime');
const {
  SUBMISSION_GRACE_MS,
  XP_PER_POINT,
  evaluateAttempt,
  percentage
} = require('../utils/quizUtils');

const FAST_ANSWER_SECONDS = 3;
const TAB_SWITCH_FLAG_THRESHOLD = 3;

const savedMapsOf = (result) => {
  const answerMap = {};
  const timeMap = {};
  (result.answers || []).forEach((a) => {
    const id = String(a.questionId);
    if (a.selectedOption) answerMap[id] = a.selectedOption;
    timeMap[id] = a.timeSpentSeconds || 0;
  });
  return { answerMap, timeMap };
};

// Behavioural forensics evaluated at submission time
const runForensics = (evaluation, violations, hasTimings) => {
  const reasons = [];
  const audit = [];

  if (violations > TAB_SWITCH_FLAG_THRESHOLD) {
    reasons.push(`Left the exam window ${violations} times`);
  }

  if (hasTimings) {
    const answered = evaluation.answers.filter((a) => a.selectedOption !== null);
    const fast = answered.filter((a) => a.timeSpentSeconds > 0 && a.timeSpentSeconds < FAST_ANSWER_SECONDS);
    if (answered.length >= 3 && fast.length / answered.length >= 0.5) {
      reasons.push(`${fast.length} of ${answered.length} answers given in under ${FAST_ANSWER_SECONDS}s`);
      audit.push({
        action: 'fast_answer',
        timestamp: new Date(),
        details: `${fast.length}/${answered.length} answers took less than ${FAST_ANSWER_SECONDS} seconds`
      });
    }
  }
  return { reasons, audit };
};

/**
 * Atomically finalises an in-progress attempt. Safe against double submission:
 * only the first caller transitions the attempt, later callers get the stored result.
 */
const finalizeAttempt = async (result, quiz, opts = {}) => {
  const now = opts.now || new Date();
  const saved = savedMapsOf(result);
  const answerMap = opts.answerMap || saved.answerMap;
  const timeMap = { ...saved.timeMap, ...(opts.timeMap || {}) };
  const submissionType = opts.submissionType || 'manual';

  const evaluation = evaluateAttempt(quiz, answerMap, timeMap);
  const violations = Math.max(result.tabSwitches || 0, Number(opts.clientViolations) || 0);
  const hasTimings = Object.values(timeMap).some((t) => t > 0);
  const forensics = runForensics(evaluation, violations, hasTimings);

  const auditEntries = [...forensics.audit, ...(opts.extraAudit || [])];
  if (submissionType === 'forced') {
    auditEntries.push({ action: 'force_submitted', timestamp: now, details: 'Exam ended by an administrator' });
  } else if (submissionType === 'auto') {
    auditEntries.push({ action: 'auto_submitted', timestamp: now, details: 'Finalised automatically after the deadline' });
  }

  // Time on task can never exceed the attempt's own deadline
  const startedMs = result.startedAt ? new Date(result.startedAt).getTime() : now.getTime();
  const endMs = Math.min(now.getTime(), result.deadline ? new Date(result.deadline).getTime() : now.getTime());
  const timeSpentSeconds = Math.max(0, Math.round((endMs - startedMs) / 1000));

  const update = {
    $set: {
      status: 'submitted',
      submittedAt: now,
      submissionType,
      score: evaluation.score,
      totalPossibleScore: evaluation.totalPossibleScore,
      answers: evaluation.answers,
      tabSwitches: violations,
      timeSpentSeconds,
      isFlagged: forensics.reasons.length > 0,
      flagReasons: forensics.reasons
    }
  };
  if (auditEntries.length) update.$push = { auditLog: { $each: auditEntries, $slice: -500 } };

  const finalized = await Result.findOneAndUpdate(
    { _id: result._id, status: 'in_progress' },
    update,
    { returnDocument: 'after' }
  );

  if (!finalized) {
    // Someone else (double click, sweeper, force-end) already finalised it
    return { result: await Result.findById(result._id), evaluation: null, alreadyFinalized: true };
  }

  await User.updateOne({ _id: finalized.user }, { $inc: { totalScore: evaluation.score } });

  // Realtime fan-out
  realtime.endLiveSession(String(finalized.user), String(quiz._id));
  realtime.emitToAdmins('results:new', {
    quizId: String(quiz._id),
    quizTitle: quiz.title,
    resultId: String(finalized._id),
    userId: String(finalized.user),
    score: finalized.score,
    totalPossibleScore: finalized.totalPossibleScore,
    percentage: percentage(finalized.score, finalized.totalPossibleScore),
    isFlagged: finalized.isFlagged,
    submissionType
  });
  realtime.notifyLeaderboardChanged();

  return { result: finalized, evaluation, alreadyFinalized: false };
};

/**
 * Finalises attempts whose deadline (plus grace) has passed. Runs on an interval and
 * on demand before results are read, so stale attempts never linger.
 */
const finalizeExpiredAttempts = async (filter = {}) => {
  const cutoff = new Date(Date.now() - SUBMISSION_GRACE_MS);
  const expired = await Result.find({ status: 'in_progress', deadline: { $lt: cutoff }, ...filter }).limit(500);
  if (!expired.length) return 0;

  const quizCache = new Map();
  let count = 0;
  for (const attempt of expired) {
    // One bad attempt must never stop the others (or break the endpoints that call this)
    try {
      const qid = String(attempt.quiz);
      if (!quizCache.has(qid)) quizCache.set(qid, await Quiz.findById(qid));
      const quiz = quizCache.get(qid);
      if (!quiz) {
        await Result.deleteOne({ _id: attempt._id });
        continue;
      }
      const forced = quiz.forceEndedAt && attempt.deadline &&
        new Date(attempt.deadline).getTime() === new Date(quiz.forceEndedAt).getTime();
      const { alreadyFinalized } = await finalizeAttempt(attempt, quiz, {
        submissionType: forced ? 'forced' : 'auto'
      });
      if (!alreadyFinalized) count++;
    } catch (err) {
      console.error(`[SWEEPER] Could not finalise attempt ${attempt._id}:`, err.message);
    }
  }
  return count;
};

let sweeper = null;
const startSweeper = (intervalMs = Number(process.env.SWEEPER_INTERVAL_MS) || 20 * 1000) => {
  if (sweeper) return;
  sweeper = setInterval(() => {
    finalizeExpiredAttempts().catch((err) => console.error('[SWEEPER] Failed to finalise attempts:', err.message));
  }, intervalMs);
  sweeper.unref();
};

const xpFor = (points) => points * XP_PER_POINT;

module.exports = { finalizeAttempt, finalizeExpiredAttempts, startSweeper, xpFor };
