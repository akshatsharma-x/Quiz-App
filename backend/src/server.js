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

// Master Tracking Map in Server Memory for the Live Exam Room
const liveTestTakers = new Map(); // socket.id -> { userId, name, email, quizId, startTime, warnings }

let activeUsers = 0;

io.on('connection', (socket) => {
  activeUsers++;
  io.emit('activeUsers', activeUsers);
  console.log(`Socket connected: ${socket.id}. Total active: ${activeUsers}`);

  // 1. Admins entering the dashboard join a special broadcast room
  socket.on('joinAdminRoom', () => {
    socket.join('admin_room');
    // Instantly hydrate the admin's table with current test-takers
    socket.emit('liveTakersUpdate', Array.from(liveTestTakers.values()));
  });

  // 2. Students starting an exam
  socket.on('startLiveExam', (studentData) => {
    socket.join(`quiz_${studentData.quizId}`);
    
    // Add student to the tracking map with a warning counter set to 0
    liveTestTakers.set(socket.id, {
      ...studentData,
      startTime: new Date(),
      warnings: 0
    });
    
    // Broadcast the updated array to all Admins watching the table
    io.to('admin_room').emit('liveTakersUpdate', Array.from(liveTestTakers.values()));
    console.log(`[LMS] Student ${studentData.name} started quiz ${studentData.quizId}`);
  });

  // 3. Proctoring & Anti-Cheat: Tab Switching Detection
  socket.on('tabSwitchDetected', () => {
    const student = liveTestTakers.get(socket.id);
    if(student) {
      student.warnings += 1; // Increment cheat flag
      console.log(`[ANTI-CHEAT] ${student.name} switched tabs! Warnings: ${student.warnings}`);
      
      // Ping the Admin with a red alert
      io.to('admin_room').emit('cheatAlert', {
        name: student.name,
        warnings: student.warnings,
        message: 'Student switched tabs or exited full-screen!'
      });
      // Refresh the main table to show the new warning count
      io.to('admin_room').emit('liveTakersUpdate', Array.from(liveTestTakers.values()));
    }
  });

  // Track Exact Duration of Focus Loss (Forensics)
  socket.on('focusRestored', ({ durationMs }) => {
    const student = liveTestTakers.get(socket.id);
    if(student) {
      // Calculate off-screen time in seconds
      const secondsOffScreen = (durationMs / 1000).toFixed(1);
      console.log(`[FORENSICS] ${student.name} was off-screen for ${secondsOffScreen}s`);
      
      io.to('admin_room').emit('cheatAlert', {
        name: student.name,
        warnings: student.warnings,
        message: `Student was off-screen for exactly ${secondsOffScreen} seconds!`
      });
    }
  });

  // 5. MODULE 7: Global Announcements
  socket.on('adminAnnouncement', (message) => {
    // Requires admin validation in a real app, assuming admin for learning
    console.log(`[BROADCAST] Admin Announcement: ${message}`);
    // Broadcast to ALL connected students securely
    socket.broadcast.emit('announcement', message);
  });

  // 6. MODULE 7: Force End Exam
  socket.on('adminForceEndExam', (quizId) => {
    console.log(`[FORCE SUBMIT] Admin force-ending Quiz: ${quizId}`);
    // Broadcast ONLY to students currently in this specific quiz room!
    io.to(`quiz_${quizId}`).emit('forceSubmitTimer');
  });

  // 7. Cleanup on disconnect (Student submits or closes browser)
  socket.on('disconnect', () => {
    activeUsers--;
    io.emit('activeUsers', activeUsers);
    
    if(liveTestTakers.has(socket.id)) {
      console.log(`[LMS] Student ${liveTestTakers.get(socket.id).name} left the exam.`);
      liveTestTakers.delete(socket.id);
      io.to('admin_room').emit('liveTakersUpdate', Array.from(liveTestTakers.values()));
    }
    console.log(`Socket disconnected: ${socket.id}. Total active: ${activeUsers}`);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
