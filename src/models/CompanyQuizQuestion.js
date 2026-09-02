const mongoose = require("mongoose");

/**
 * CompanyQuizQuestion Schema
 * ───────────────────────────
 * Micro-quiz cards presented between reels to test comprehension
 * and trigger adaptive knowledge reinforcement loops.
 */
const AnswerOptionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const CompanyQuizQuestionSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, trim: true, index: true },
    question: { type: String, required: true, trim: true },
    answerOptions: [AnswerOptionSchema],
    correctAnswerId: { type: String, required: true, select: true },
    explanation: { type: String, default: "", trim: true },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    roleApplicability: [{ type: String, trim: true }],
    linkedReelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyReel",
      default: null,
      index: true,
    },
    passFailConsequence: {
      type: String,
      enum: ["reinforce", "lock_gate", "flag_manager"],
      default: "reinforce",
    },
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["active", "retired"],
      default: "active",
      index: true,
    },
    effectiveFrom: { type: Date, default: Date.now },
    retirementDate: { type: Date, default: null },
  },
  { timestamps: true }
);

CompanyQuizQuestionSchema.index({ topic: 1, status: 1 });

module.exports = mongoose.model("CompanyQuizQuestion", CompanyQuizQuestionSchema);
