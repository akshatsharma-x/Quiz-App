require('dotenv').config();
const nodemailer = require('nodemailer');

async function testMail() {
  console.log("Testing with User:", process.env.SMTP_EMAIL);
  // Log password length to verify it's reading the updated .env without printing the actual password
  console.log("Password length:", process.env.SMTP_PASSWORD ? process.env.SMTP_PASSWORD.length : 0);
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD
    }
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: 'akshat@muj.manipal.edu', // Sending a test to a known format
      subject: 'Nodemailer Test',
      text: 'This is a test from the manual script.'
    });
    console.log("SUCCESS:", info.messageId);
  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

testMail();
