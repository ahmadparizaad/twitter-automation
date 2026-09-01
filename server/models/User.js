const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: String,
  url: String,
  description: { type: String, maxlength: 280 }
});

const UserSchema = new mongoose.Schema({
  googleId: { type: String, required: true, index: true },
  displayName: String,
  email: String,
  role: String,
  short_bio: { type: String, maxlength: 280, default: '' },
  projects: [ProjectSchema],
  refreshToken: String,
  refreshTokenExpiresAt: { type: Date },
  preferences: { type: Object, default: {} },
  autoGenerate: { type: Boolean, default: false },

  // Plan & billing
  plan: { type: String, enum: ['trial', 'credits'], default: 'trial' },
  trialStartedAt: { type: Date, default: null },
  trialDailyCount: { type: Number, default: 0 },
  trialDailyReset: { type: Date, default: null },
  credits: { type: Number, default: 0 },
  creditsUsed: { type: Number, default: 0 },

  // Legacy usage (kept for backward compat, no longer enforced)
  usage: {
    dailyCount: { type: Number, default: 0 },
    lastReset: { type: Date, default: Date.now }
  }
}, { timestamps: true });

// Virtual: is trial still active (within 3 days of trialStartedAt)
UserSchema.virtual('isTrialActive').get(function () {
  if (!this.trialStartedAt) return false;
  const trialDurationMs = 3 * 24 * 60 * 60 * 1000;
  return Date.now() - this.trialStartedAt.getTime() < trialDurationMs;
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
