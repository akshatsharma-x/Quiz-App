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
  }
});

// Prevent user from submitting the same quiz twice
ResultSchema.index({ quiz: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Result', ResultSchema);
