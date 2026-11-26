// Populates the database with realistic demo data so every screen has something to show.
//   npm run seed:demo             → add demo data (skipped if demo accounts already exist)
//   npm run seed:demo -- --reset  → first remove ALL quizzes, results, announcements and bank
//                                   questions, then rebuild the demo dataset
// Demo accounts sign in with the password "Demo1234". No emails are sent by this script.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');
const ensureAdmin = require('./src/utils/seedAdmin');
const { seedDemoData, demoAccounts } = require('./src/utils/demoData');

if (process.env.NODE_ENV === 'production' && process.env.SHOWCASE_MODE !== 'true') {
  console.error('Refusing to seed demo data with NODE_ENV=production (use SHOWCASE_MODE=true for a public demo).');
  process.exit(1);
}

const RESET = process.argv.includes('--reset');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (!RESET && await User.exists({ email: /^demo\./ })) {
    console.log('Demo data is already present. Run with --reset to recreate it.');
    await mongoose.disconnect();
    return;
  }
  await ensureAdmin();
  const r = await seedDemoData({ reset: RESET });
  const acc = demoAccounts();
  console.log(`Seeded ${r.students} students, ${r.questions} bank questions, ${r.quizzes} quizzes, ${r.attempts} attempts and ${r.announcements} announcements.`);
  console.log(`Student sign-in: ${acc.student.email} / ${acc.student.password}  (every demo.* student uses the same password)`);
  console.log(`Faculty sign-in: ${acc.faculty.email} / ${acc.faculty.password}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Demo seed failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
