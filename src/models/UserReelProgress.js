const mongoose = require("mongoose");

/**
 * UserReelProgress Schema
 * ───────────────────────
 * Aggregated training progression, streak counters, badges,
 * and adaptive knowledge gaps for an individual user/employee.
 */
const CompletedReelItemSchema = new mongoose.Schema(
  {
    reelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyReel",
      required: true,
    },
    completedAt: { type: Date, default: Date.now },
    watchCount: { type: Number, default: 1 },
  },
  { _id: false }
);

const FailedTopicItemSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    failCount: { type: Number, default: 1 },
    consecutivePasses: { type: Number, default: 0 },
    lastFailedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
  },
  { _id: false }
);

const BadgeItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "award" },
    awardedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CertificationItemSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "expiring_soon", "expired", "in_progress"],
      default: "active",
    },
    awardedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const UserReelProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,
      index: true,
    },
    completedReels: [CompletedReelItemSchema],
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: "" }, // YYYY-MM-DD
    knowledgeScore: { type: Number, default: 100 }, // percentage 0-100
    totalPoints: { type: Number, default: 0 },
    progressionLevel: {
      type: Number,
      enum: [1, 2, 3, 4],
      default: 1, // 1: New Hire, 2: Trained, 3: Advanced, 4: Lead
    },
    badges: [BadgeItemSchema],
    failedTopics: [FailedTopicItemSchema],
    certifications: [CertificationItemSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserReelProgress", UserReelProgressSchema);
