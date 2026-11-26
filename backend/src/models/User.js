const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [80, 'Name cannot be more than 80 characters']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: [254, 'Email is too long'],
    // Plain address characters only (no quotes/comments/angle brackets that mail parsers
    // interpret) and linear-time: domain labels exclude the dot that separates them
    match: [/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'Please add a valid email']
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  passwordChangedAt: {
    type: Date,
    select: false
  },
  // Legacy denormalised counter (points). Leaderboards are computed from Results.
  totalScore: {
    type: Number,
    default: 0
  },
  streak: {
    type: Number,
    default: 0
  },

  // One-time passwords are stored hashed and are bound to a purpose.
  otp: { type: String, select: false },
  otpExpire: { type: Date, select: false },
  otpPurpose: { type: String, enum: ['verify', 'login', 'reset'], select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  otpLastSentAt: { type: Date, select: false },

  isVerified: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  lastSeenAnnouncementsAt: {
    type: Date
  },
  lastLoginAt: {
    type: Date
  },

  // LMS FEATURE: Cohort Management & Academic Identity
  program: { type: String, trim: true },
  branch: { type: String, trim: true },
  batchYear: { type: String, trim: true },
  semester: { type: String, trim: true },
  section: { type: String, trim: true, index: true },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Encrypt password using bcrypt
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  // Tokens issued before this moment become invalid (see middlewares/auth.js)
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password || typeof enteredPassword !== 'string') return false;
  return bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.hasCompleteProfile = function () {
  return Boolean(this.program && this.branch && this.batchYear && this.semester && this.section);
};

// Safe public representation – never leaks credentials or OTP state
UserSchema.methods.toPublic = function () {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    isVerified: this.isVerified,
    isBanned: this.isBanned,
    program: this.program || null,
    branch: this.branch || null,
    batchYear: this.batchYear || null,
    semester: this.semester || null,
    section: this.section || null,
    profileComplete: this.role === 'admin' ? true : this.hasCompleteProfile(),
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt || null
  };
};

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.otp;
    delete ret.otpExpire;
    delete ret.otpPurpose;
    delete ret.otpAttempts;
    delete ret.otpLastSentAt;
    delete ret.passwordChangedAt;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', UserSchema);
