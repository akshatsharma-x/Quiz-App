const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  quiz: {
    type: mongoose.Schema.ObjectId,
    ref: 'Quiz',
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  totalPossibleScore: {
    type: Number,
    required: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  tabSwitches: {
    type: Number,
    default: 0
  },
  timeSpentSeconds: {
    type: Number
  },
  
  // PROCTORING & ANTI-CHEAT: Deep Auditing
  auditLog: [{
    action: {
      type: String,
      enum: ['tab_switch', 'window_blur', 'mouse_leave', 'network_disconnect', 'full_screen_exit'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: String
  }],
  questionMetrics: [{
    questionId: {
      type: mongoose.Schema.ObjectId,
      ref: 'QuestionBank'
    },
    timeSpentSeconds: Number,
    isCorrect: Boolean
  }],
  isFlagged: {
    type: Boolean,
    default: false
  }
});

// Prevent user from submitting the same quiz twice
ResultSchema.index({ quiz: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Result', ResultSchema);
