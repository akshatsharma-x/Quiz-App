const Result = require('../models/Result');
const User = require('../models/User');

/**
 * Idempotent data fixes for databases created by earlier versions of QuizMUJ.
 * Safe to run on every boot.
 */
const runMigrations = async () => {
  // 1. Results created before attempts had a lifecycle are completed submissions
  const results = await Result.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'submitted', quizType: 'native' } }
  );
  if (results.modifiedCount) console.log(`[MIGRATE] Marked ${results.modifiedCount} legacy result(s) as submitted`);

  // 2. Emails used to be stored with their original casing, which broke case-insensitive login
  const mixedCase = await User.find({ email: { $regex: /[A-Z]/ } }).select('_id email');
  let fixed = 0;
  for (const u of mixedCase) {
    const lower = u.email.toLowerCase();
    // Skip if another account already owns the lowercase address (needs a manual merge)
    if (await User.exists({ email: lower, _id: { $ne: u._id } })) {
      console.warn(`[MIGRATE] Could not lowercase ${u.email}: ${lower} already exists`);
      continue;
    }
    await User.updateOne({ _id: u._id }, { $set: { email: lower } });
    fixed++;
  }
  if (fixed) console.log(`[MIGRATE] Normalised ${fixed} email address(es) to lowercase`);
};

module.exports = runMigrations;
