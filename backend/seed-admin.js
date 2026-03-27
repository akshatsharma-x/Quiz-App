const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

// Override the URI to use localhost mapped port for host-execution
const uri = 'mongodb://127.0.0.1:27017/quizmuj';

mongoose.connect(uri).then(async () => {
  try {
    const exists = await User.findOne({email:'admin@quizmuj.com'});
    if(exists){
      exists.password = 'admin123';
      await exists.save();
      console.log('✅ Admin already exists! Force-updated password back to: admin123');
    } else {
      await User.create({
        name:'QuizMUJ Admin',
        email:'admin@quizmuj.com',
        password:'admin123',
        role:'admin',
        isVerified:true
      });
      console.log('✅ Admin account (admin@quizmuj.com / admin123) successfully seeded.');
    }
  } catch(e) {
    console.error('Error seeding admin UI:', e);
  } finally {
    process.exit(0);
  }
}).catch(e => {
  console.error('Connection error:', e);
  process.exit(1);
});
