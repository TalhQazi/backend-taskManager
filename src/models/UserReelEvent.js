const mongoose = require("mongoose");

/**
 * UserReelEvent Schema
 * ────────────────────
 * Captures high-frequency employee interaction telemetry on reels.
 * Completion is determined server-side (e.g. >= 90% watched).
 */
const UserReelEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    reelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyReel",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ["start", "pause", "resume", "skip", "replay", "watch_progress", "complete"],
      required: true,
      index: true,
    },
    watchDurationSec: { type: Number, default: 0 },
    percentWatched: { type: Number, default: 0 }, // 0 to 100
    completed: { type: Boolean, default: false, index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    metadata: {
      clientPlatform: { type: String, default: "mobile" },
      soundMuted: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

UserReelEventSchema.index({ userId: 1, reelId: 1, completed: 1 });
UserReelEventSchema.index({ reelId: 1, eventType: 1 });
UserReelEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model("UserReelEvent", UserReelEventSchema);
