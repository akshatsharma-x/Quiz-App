require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const dbUri = process.env.MONGO_URI || 'mongodb://localhost:27017/quizmuj';
mongoose.connect(dbUri);

async function check() {
  const user = await User.findOne({ email: 'akshat.23fe10cse00677@muj.manipal.edu'}).select('+otp +otpExpire');
  console.log(user ? 'User OTP exists: ' + !!user.otp : 'User not found');
  process.exit(0);
}
check();
