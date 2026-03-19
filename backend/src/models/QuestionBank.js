const mongoose = require('mongoose');

const QuestionBankSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: [true, 'Question text is required']
  },
  options: {
    type: [String],
    required: [true, 'Options are required'],
    validate: [arrayLimit, 'Must have at least 2 and at most 6 options']
  },
  correctAnswer: {
    type: String,
    required: [true, 'Correct answer is required']
  },
  tags: {
    type: [String],
    index: true // Indexed for rapid querying during dynamic quiz generation (e.g. #physics)
  },
  explanation: {
    type: String 
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

function arrayLimit(val) {
  return val.length >= 2 && val.length <= 6;
}

// Full text search index allows the Admin to quickly search the question bank by keywords
QuestionBankSchema.index({ questionText: 'text' });

module.exports = mongoose.model('QuestionBank', QuestionBankSchema);
