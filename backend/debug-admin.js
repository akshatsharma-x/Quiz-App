const mongoose = require('mongoose');
const User = require('./src/models/User');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizmuj';

mongoose.connect(uri).then(async () => {
  try {
    const user = await User.findOne({email: 'admin@quizmuj.com'}).select('+password');
    if (!user) {
      console.log('User not found in the DB.');
    } else {
      console.log('Found user:', user.email);
      console.log('Password length:', user.password ? user.password.length : 'undefined', 'Is it hashed?', user.password && user.password.startsWith('$2'));
      console.log('Exact password stored:', user.password); // DO NOT DO THIS IN PROD, just debugging locally
      
      const isMatch = await user.matchPassword('admin123');
      console.log('Does "admin123" match?', isMatch);
    }
  } catch(e) {
    console.error('Debug error:', e);
  } finally {
    process.exit(0);
  }
}).catch(e => {
  console.error('Connection error:', e);
  process.exit(1);
});
