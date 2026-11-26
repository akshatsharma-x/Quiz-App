// Sends a test email to verify SMTP settings:  npm run test:email -- you@example.com
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sendEmail = require('./src/utils/sendEmail');

const to = process.argv[2] || process.env.SMTP_EMAIL;
if (!to) {
  console.error('Usage: npm run test:email -- recipient@example.com');
  process.exit(1);
}

process.env.NODE_ENV = 'production'; // surface delivery errors instead of the dev fallback
sendEmail({ email: to, subject: 'QuizMUJ SMTP test', message: 'SMTP is configured correctly.' })
  .then(() => console.log(`SUCCESS: test email sent to ${to}`))
  .catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
