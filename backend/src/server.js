const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const errorHandler = require('./middlewares/error');

// Load env vars
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

// Connect to database
const connectDB = require('./config/db');
connectDB();

const app = express();

// Body parser
app.use(express.json());

// Route files
const authRouter = require('./routes/auth');
const quizzesRouter = require('./routes/quizzes');
const adminRouter = require('./routes/admin');

// Enable CORS
app.use(cors());

// Mount routers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/quizzes', quizzesRouter);
app.use('/api/v1/admin', adminRouter);

// Basic health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'QuizMUJ API is running',
    timestamp: new Date().toISOString()
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 5001;

const server = app.listen(
  PORT,
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);

// Setup Socket.io
const socketio = require('socket.io');
const io = socketio(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let activeUsers = 0;

io.on('connection', (socket) => {
  activeUsers++;
  io.emit('activeUsers', activeUsers);
  console.log(`Socket connected: ${socket.id}. Total active: ${activeUsers}`);

  // When a student starts a quiz
  socket.on('joinQuiz', (quizId) => {
    socket.join(`quiz_${quizId}`);
    console.log(`Socket ${socket.id} joined quiz ${quizId}`);
  });

  // Example: Emit a live leaderboard update to a specific quiz room
  socket.on('updateLeaderboard', ({ quizId, result }) => {
    io.to(`quiz_${quizId}`).emit('newLeaderboardData', result);
  });

  // Anti-Cheat: Listen for tab switches
  socket.on('tabSwitch', (data) => {
    const { userId, quizId, timestamp } = data;
    console.log(`[ANTI-CHEAT ALERT] User ${userId} switched tabs during Quiz ${quizId} at ${timestamp}`);
    // Emit alert to admins listening on a special admin room
    io.emit('cheatAlert', {
      userId,
      quizId,
      timestamp,
      message: 'Tab switch detected!'
    });
  });

  socket.on('disconnect', () => {
    activeUsers--;
    io.emit('activeUsers', activeUsers);
    console.log(`Socket disconnected: ${socket.id}. Total active: ${activeUsers}`);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
