const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: true
  },
  options: {
    type: [String],
    required: true,
    validate: [arrayLimit, '{PATH} exceeds the limit of options']
  },
  correctAnswer: {
    type: String,
    required: true
  }
});

function arrayLimit(val) {
  return val.length >= 2 && val.length <= 6;
}

const QuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a quiz title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  type: {
    type: String,
    enum: ['native', 'google_form'],
    required: [true, 'Please specify if the quiz is native or google_form']
  },
  googleFormUrl: {
    type: String,
    match: [
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/,
      'Please use a valid URL with HTTP or HTTPS'
    ],
    required: function() {
      return this.type === 'google_form';
    }
  },
  questions: {
    type: [QuestionSchema],
    required: function() {
      return this.type === 'native';
    }
  },
  pointsPerQuestion: {
    type: Number,
    default: 1
  },
  startTime: {
    type: Date,
    required: [true, 'Please add a start time for the quiz']
  },
  endTime: {
    type: Date,
    required: [true, 'Please add an end time for the quiz']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Quiz', QuizSchema);
