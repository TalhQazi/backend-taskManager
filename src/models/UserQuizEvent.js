const mongoose = require("mongoose");

/**
 * UserQuizEvent Schema
 * ────────────────────
 * Permanent audit trail of employee quiz attempts, answers, and outcomes.
 */
const UserQuizEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyQuizQuestion",
      required: true,
      index: true,
    },
    sourceReelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyReel",
      default: null,
      index: true,
    },
    selectedAnswerId: { type: String, required: true },
    correct: { type: Boolean, required: true, index: true },
    topic: { type: String, default: "", index: true },
    responseTimeMs: { type: Number, default: 0 },
    answeredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

UserQuizEventSchema.index({ userId: 1, topic: 1, correct: 1 });
UserQuizEventSchema.index({ userId: 1, questionId: 1, correct: 1 });

module.exports = mongoose.model("UserQuizEvent", UserQuizEventSchema);
