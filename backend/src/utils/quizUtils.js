const crypto = require('crypto');

const COHORT_FIELDS = ['program', 'branch', 'batchYear', 'semester', 'section'];
const TARGET_FIELDS = ['targetProgram', 'targetBranch', 'targetBatchYear', 'targetSemester', 'targetSection'];

// Submissions are accepted for this long after the attempt deadline (network latency,
// clock skew). After that, the server finalises the attempt from its autosaved answers.
const SUBMISSION_GRACE_MS = Number(process.env.SUBMISSION_GRACE_MS) || 30 * 1000;

const XP_PER_POINT = 10;

const TIERS = [
  { name: 'Bronze', min: 0, color: '#cd7f32' },
  { name: 'Silver', min: 200, color: '#c0c7d1' },
  { name: 'Gold', min: 500, color: '#fbbf24' },
  { name: 'Platinum', min: 1000, color: '#67e8f9' },
  { name: 'Diamond', min: 2000, color: '#a78bfa' },
  { name: 'Legend', min: 4000, color: '#ff7900' }
];

const pickTargets = (src = {}) => {
  const out = {};
  TARGET_FIELDS.forEach((f) => {
    const v = typeof src[f] === 'string' ? src[f].trim() : '';
    out[f] = v || 'All';
  });
  return out;
};

// Does a quiz/announcement (with target* fields) apply to this student?
const matchesCohort = (target, user) => {
  if (!user || user.role === 'admin') return true;
  return COHORT_FIELDS.every((field, i) => {
    const t = target[TARGET_FIELDS[i]] || 'All';
    return t === 'All' || t === user[field];
  });
};

// Mongo filter equivalent of matchesCohort
const cohortFilterFor = (user) => {
  const filter = {};
  COHORT_FIELDS.forEach((field, i) => {
    filter[TARGET_FIELDS[i]] = { $in: [user[field], 'All'] };
  });
  return filter;
};

const quizStatus = (quiz, now = new Date()) => {
  if (!quiz.isActive) return 'inactive';
  if (now < new Date(quiz.startTime)) return 'scheduled';
  if (now > new Date(quiz.endTime)) return 'ended';
  return 'live';
};

// When "after_end" answers become visible: running attempts may still submit/autosave for
// SUBMISSION_GRACE_MS after the window closes, so reveal only once that grace has elapsed.
const revealTime = (quiz) => new Date(new Date(quiz.endTime).getTime() + SUBMISSION_GRACE_MS);

const canRevealAnswers = (quiz, now = new Date()) => {
  if (quiz.answerReveal === 'immediately') return true;
  if (quiz.answerReveal === 'never') return false;
  return now > revealTime(quiz); // after_end (default)
};

const totalPointsOf = (quiz) => (quiz.questions ? quiz.questions.length : 0) * (quiz.pointsPerQuestion || 1);

// Everything a student may know about a quiz before/without starting it (no questions!)
const toStudentQuizSummary = (quiz, now = new Date()) => ({
  _id: quiz._id,
  title: quiz.title,
  description: quiz.description || '',
  type: quiz.type,
  timeLimit: quiz.timeLimit || null,
  startTime: quiz.startTime,
  endTime: quiz.endTime,
  questionCount: quiz.type === 'native' ? (quiz.questions || []).length : 0,
  pointsPerQuestion: quiz.pointsPerQuestion || 1,
  totalPoints: quiz.type === 'native' ? totalPointsOf(quiz) : 0,
  passPercentage: quiz.passPercentage ?? 40,
  answerReveal: quiz.answerReveal || 'after_end',
  status: quizStatus(quiz, now),
  targetProgram: quiz.targetProgram,
  targetBranch: quiz.targetBranch,
  targetBatchYear: quiz.targetBatchYear,
  targetSemester: quiz.targetSemester,
  targetSection: quiz.targetSection
});

// Deterministic PRNG so a student's shuffled order survives page reloads
const seededRandom = (seed) => {
  let h = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seededShuffle = (arr, seed) => {
  const out = arr.slice();
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Questions as delivered to a student for a given attempt (no answers, optional shuffling)
const questionsForAttempt = (quiz, attemptId) => {
  let questions = quiz.questions.map((q) => ({
    _id: q._id,
    questionText: q.questionText,
    options: q.options.slice()
  }));
  if (quiz.shuffleQuestions) questions = seededShuffle(questions, `${attemptId}:questions`);
  if (quiz.shuffleOptions) {
    questions = questions.map((q) => ({ ...q, options: seededShuffle(q.options, `${attemptId}:${q._id}`) }));
  }
  return questions;
};

/**
 * Scores an attempt.
 * @param quiz       Quiz document
 * @param answerMap  { [questionId]: selectedOptionText }
 * @param timeMap    { [questionId]: secondsSpent }
 */
const evaluateAttempt = (quiz, answerMap = {}, timeMap = {}) => {
  const points = quiz.pointsPerQuestion || 1;
  let score = 0;
  let correctCount = 0;
  let answeredCount = 0;

  const answers = quiz.questions.map((q) => {
    const id = String(q._id);
    const raw = answerMap[id];
    const selected = typeof raw === 'string' && q.options.includes(raw) ? raw : null;
    const isCorrect = selected !== null && selected === q.correctAnswer;
    if (selected !== null) answeredCount++;
    if (isCorrect) {
      score += points;
      correctCount++;
    }
    const t = Number(timeMap[id]);
    return {
      questionId: q._id,
      selectedOption: selected,
      isCorrect,
      timeSpentSeconds: Number.isFinite(t) && t >= 0 ? Math.min(Math.round(t), 36000) : 0
    };
  });

  return {
    score,
    totalPossibleScore: quiz.questions.length * points,
    answers,
    correctCount,
    answeredCount,
    incorrectCount: answeredCount - correctCount,
    unansweredCount: quiz.questions.length - answeredCount
  };
};

// Normalises client answer payloads: array of {questionId, selectedOption} or a plain map
const toAnswerMap = (answers) => {
  const map = {};
  if (Array.isArray(answers)) {
    answers.forEach((a) => {
      if (a && a.questionId != null && typeof a.selectedOption === 'string') {
        map[String(a.questionId)] = a.selectedOption;
      }
    });
  } else if (answers && typeof answers === 'object') {
    Object.entries(answers).forEach(([k, v]) => {
      if (typeof v === 'string') map[String(k)] = v;
    });
  }
  return map;
};

const toTimeMap = (metrics) => {
  const map = {};
  if (Array.isArray(metrics)) {
    metrics.forEach((m) => {
      if (m && m.questionId != null) map[String(m.questionId)] = Number(m.timeSpentSeconds) || 0;
    });
  } else if (metrics && typeof metrics === 'object') {
    Object.entries(metrics).forEach(([k, v]) => { map[String(k)] = Number(v) || 0; });
  }
  return map;
};

const getTier = (xp) => {
  let idx = 0;
  TIERS.forEach((t, i) => { if (xp >= t.min) idx = i; });
  const current = TIERS[idx];
  const next = TIERS[idx + 1] || null;
  return {
    name: current.name,
    color: current.color,
    min: current.min,
    next: next ? { name: next.name, min: next.min, xpNeeded: next.min - xp } : null,
    progress: next ? Math.round(((xp - current.min) / (next.min - current.min)) * 100) : 100
  };
};

// ---- Calendar days in the app's timezone (default IST) --------------------------------------
const appTimeZone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
let dayFormatter = null;
const dayKey = (d) => {
  if (!dayFormatter || dayFormatter.resolvedOptions().timeZone !== appTimeZone()) {
    dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return dayFormatter.format(new Date(d)); // YYYY-MM-DD
};
// Pure calendar arithmetic on YYYY-MM-DD keys (immune to DST and server timezone)
const shiftDayKey = (key, deltaDays) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
};

// Consecutive calendar days (ending today or yesterday) with at least one submission
const computeStreak = (dates, now = new Date()) => {
  const days = new Set(dates.map(dayKey));
  let cursor = dayKey(now);
  if (!days.has(cursor)) cursor = shiftDayKey(cursor, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
};

const percentage = (score, total) => (total > 0 ? Math.round((score / total) * 1000) / 10 : 0);

module.exports = {
  COHORT_FIELDS,
  TARGET_FIELDS,
  SUBMISSION_GRACE_MS,
  XP_PER_POINT,
  TIERS,
  pickTargets,
  matchesCohort,
  cohortFilterFor,
  quizStatus,
  canRevealAnswers,
  revealTime,
  totalPointsOf,
  toStudentQuizSummary,
  seededShuffle,
  questionsForAttempt,
  evaluateAttempt,
  toAnswerMap,
  toTimeMap,
  getTier,
  computeStreak,
  appTimeZone,
  dayKey,
  shiftDayKey,
  percentage
};
