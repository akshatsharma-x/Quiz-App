const Result = require('../models/Result');
const { XP_PER_POINT, getTier, percentage } = require('../utils/quizUtils');

const SCOPES = ['global', 'batch', 'section'];

// Cohort filter applied to the joined user document
const scopeMatch = (scope, me) => {
  if (!me || scope === 'global') return {};
  const base = { 'u.program': me.program, 'u.branch': me.branch, 'u.batchYear': me.batchYear };
  if (scope === 'section') base['u.section'] = me.section;
  return base;
};

/**
 * Ranks students by points earned on native quizzes (XP = points × 10).
 * Ties share a rank (competition ranking); higher accuracy breaks visual ordering.
 */
const computeLeaderboard = async ({ scope = 'global', me = null } = {}) => {
  const rows = await Result.aggregate([
    { $match: { status: 'submitted', quizType: { $ne: 'google_form' } } },
    {
      $group: {
        _id: '$user',
        points: { $sum: '$score' },
        possible: { $sum: '$totalPossibleScore' },
        quizzes: { $sum: 1 },
        lastAt: { $max: '$submittedAt' }
      }
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $unwind: '$u' },
    { $match: { 'u.role': 'user', 'u.isBanned': { $ne: true }, ...scopeMatch(scope, me) } },
    { $addFields: { accuracy: { $cond: [{ $gt: ['$possible', 0] }, { $divide: ['$points', '$possible'] }, 0] } } },
    { $sort: { points: -1, accuracy: -1, lastAt: 1 } }
  ]);

  let lastPoints = null;
  let lastRank = 0;
  return rows.map((r, i) => {
    const rank = r.points === lastPoints ? lastRank : i + 1;
    lastPoints = r.points;
    lastRank = rank;
    const xp = r.points * XP_PER_POINT;
    return {
      rank,
      userId: String(r._id),
      name: r.u.name,
      program: r.u.program || null,
      branch: r.u.branch || null,
      batchYear: r.u.batchYear || null,
      section: r.u.section || null,
      xp,
      points: r.points,
      quizzes: r.quizzes,
      avgPercentage: percentage(r.points, r.possible),
      tier: getTier(xp)
    };
  });
};

module.exports = { computeLeaderboard, SCOPES };
