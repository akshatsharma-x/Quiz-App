const mongoose = require('mongoose');

const QuestionBankSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: [true, 'Question text is required'],
    trim: true,
    maxlength: [2000, 'Question text cannot exceed 2000 characters']
  },
  options: {
    type: [{ type: String, trim: true }],
    required: [true, 'Options are required'],
    validate: [
      {
        validator: (val) => Array.isArray(val) && val.length >= 2 && val.length <= 6,
        message: 'Must have at least 2 and at most 6 options'
      },
      {
        validator: (val) => new Set(val.map((o) => String(o).trim().toLowerCase())).size === val.length,
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
    index: true // Indexed for rapid querying during dynamic quiz generation (e.g. #physics)
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: [2000, 'Explanation cannot exceed 2000 characters']
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

// Full text search index allows the Admin to quickly search the question bank by keywords
QuestionBankSchema.index({ questionText: 'text' });

module.exports = mongoose.model('QuestionBank', QuestionBankSchema);
