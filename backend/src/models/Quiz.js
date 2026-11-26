const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: [true, 'Question text is required'],
    trim: true,
    maxlength: [2000, 'Question text cannot exceed 2000 characters']
  },
  options: {
    type: [{ type: String, trim: true }],
    required: true,
    validate: [
      {
        validator: (val) => Array.isArray(val) && val.length >= 2 && val.length <= 6,
        message: 'Each question needs between 2 and 6 options'
      },
      {
        validator: (val) => val.every((o) => typeof o === 'string' && o.trim().length > 0),
        message: 'Options cannot be empty'
      },
      {
        validator: (val) => new Set(val.map((o) => o.trim().toLowerCase())).size === val.length,
        message: 'Options within a question must be unique'
      }
    ]
  },
  correctAnswer: {
    type: String,
    required: [true, 'Correct answer is required'],
    trim: true,
    validate: {
      validator: function (val) {
        return Array.isArray(this.options) && this.options.includes(val);
      },
      message: 'Correct answer must exactly match one of the options'
    }
  },
  tags: {
    type: [{ type: String, trim: true, lowercase: true }],
    default: []
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: [2000, 'Explanation cannot exceed 2000 characters']
  }
});

const QuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a quiz title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  type: {
    type: String,
    enum: ['native', 'google_form'],
    required: [true, 'Please specify if the quiz is native or google_form']
  },
  googleFormUrl: {
    type: String,
    trim: true,
    match: [/^https?:\/\/[^\s]+$/i, 'Please use a valid URL with HTTP or HTTPS'],
    required: [function () { return this.type === 'google_form'; }, 'An external form URL is required']
  },
  questions: [QuestionSchema],
  // Minutes. The attempt deadline is min(start + timeLimit, endTime).
  timeLimit: {
    type: Number,
    min: [1, 'Time limit must be at least 1 minute'],
    max: [600, 'Time limit cannot exceed 600 minutes'],
    required: [function () { return this.type === 'native'; }, 'Please add a time limit']
  },
  targetProgram: { type: String, default: 'All' },
  targetBranch: { type: String, default: 'All' },
  targetBatchYear: { type: String, default: 'All' },
  targetSemester: { type: String, default: 'All' },
  targetSection: { type: String, default: 'All' },
  pointsPerQuestion: {
    type: Number,
    default: 1,
    min: [1, 'Points per question must be at least 1'],
    max: [100, 'Points per question cannot exceed 100']
  },
  passPercentage: {
    type: Number,
    default: 40,
    min: 0,
    max: 100
  },
  shuffleQuestions: { type: Boolean, default: false },
  shuffleOptions: { type: Boolean, default: false },
  // When students may see correct answers & explanations for their attempt
  answerReveal: {
    type: String,
    enum: ['immediately', 'after_end', 'never'],
    default: 'after_end'
  },
  startTime: {
    type: Date,
    required: [true, 'Please add a start time for the quiz']
  },
  endTime: {
    type: Date,
    required: [true, 'Please add an end time for the quiz'],
    validate: {
      validator: function (val) {
        // `this` is the document on save; skip on query validators
        if (!(this instanceof mongoose.Document)) return true;
        return !this.startTime || val > this.startTime;
      },
      message: 'End time must be after the start time'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  forceEndedAt: Date,
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

QuizSchema.index({ startTime: 1, endTime: 1 });

QuizSchema.pre('validate', function () {
  if (this.type === 'native' && (!this.questions || this.questions.length === 0)) {
    this.invalidate('questions', 'Native quizzes need at least one question');
  }
});

module.exports = mongoose.model('Quiz', QuizSchema);
