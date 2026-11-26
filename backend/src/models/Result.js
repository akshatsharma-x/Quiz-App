const mongoose = require('mongoose');

const AUDIT_ACTIONS = [
  'tab_switch',
  'window_blur',
  'mouse_leave',
  'network_disconnect',
  'full_screen_exit',
  'focus_restored',
  'copy_attempt',
  'fast_answer',
  'late_submission',
  'force_submitted',
  'auto_submitted'
];

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
  quizType: {
    type: String,
    enum: ['native', 'google_form'],
    default: 'native'
  },
  // An attempt is created as 'in_progress' when the student starts the exam and is
  // finalised on submit (or automatically once its server-side deadline has passed).
  status: {
    type: String,
    enum: ['in_progress', 'submitted'],
    default: 'submitted',
    index: true
  },
  startedAt: Date,
  deadline: Date,
  lastSavedAt: Date,
  score: {
    type: Number,
    default: 0
  },
  totalPossibleScore: {
    type: Number,
    default: 0
  },
  answers: [{
    _id: false,
    questionId: { type: mongoose.Schema.ObjectId, required: true },
    selectedOption: { type: String, default: null },
    isCorrect: { type: Boolean, default: false },
    timeSpentSeconds: { type: Number, default: 0 }
  }],
  submittedAt: {
    type: Date
  },
  submissionType: {
    type: String,
    enum: ['manual', 'timeout', 'forced', 'auto', 'external'],
    default: 'manual'
  },
  // Number of proctoring violations (tab switches, full-screen exits, …)
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
      enum: AUDIT_ACTIONS,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: String
  }],
  isFlagged: {
    type: Boolean,
    default: false
  },
  flagReasons: {
    type: [String],
    default: []
  }
}, { timestamps: true });

// One attempt per student per quiz (admins can reset an attempt to allow a retake)
ResultSchema.index({ quiz: 1, user: 1 }, { unique: true });
ResultSchema.index({ user: 1, status: 1, submittedAt: -1 });

ResultSchema.statics.AUDIT_ACTIONS = AUDIT_ACTIONS;

module.exports = mongoose.model('Result', ResultSchema);
