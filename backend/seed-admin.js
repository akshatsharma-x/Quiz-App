// Creates (or resets) the administrator account.
//   npm run seed            → create admin if none exists
//   npm run seed -- --reset → also reset the admin password
// Credentials: ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (defaults: admin@quizmuj.com / admin123)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizmuj';
const email = (process.env.ADMIN_EMAIL || 'admin@quizmuj.com').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'admin123';
const name = process.env.ADMIN_NAME || 'QuizMUJ Admin';
const reset = process.argv.includes('--reset');

mongoose.connect(uri).then(async () => {
  try {
    const existing = await User.findOne({ email });
    if (existing) {
      existing.role = 'admin';
      existing.isVerified = true;
      existing.isBanned = false;
      if (reset) existing.password = password;
      await existing.save({ validateBeforeSave: false });
      console.log(reset
        ? `✅ Admin ${email} exists – password reset.`
        : `✅ Admin ${email} already exists (use --reset to reset the password).`);
    } else {
      await User.create({ name, email, password, role: 'admin', isVerified: true });
      console.log(`✅ Admin account ${email} created.`);
    }
  } catch (e) {
    console.error('Error seeding admin:', e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}).catch((e) => {
  console.error('Connection error:', e.message);
  process.exit(1);
});
