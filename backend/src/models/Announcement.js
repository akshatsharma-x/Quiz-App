const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters'],
    default: 'Announcement'
  },
  message: {
    type: String,
    required: [true, 'Announcement message is required'],
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  priority: {
    type: String,
    enum: ['info', 'important', 'urgent'],
    default: 'info'
  },
  targetProgram: { type: String, default: 'All' },
  targetBranch: { type: String, default: 'All' },
  targetBatchYear: { type: String, default: 'All' },
  targetSemester: { type: String, default: 'All' },
  targetSection: { type: String, default: 'All' },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

AnnouncementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Announcement', AnnouncementSchema);
