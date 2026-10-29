const mongoose = require("mongoose");

/**
 * CompanyTrainingPath Schema
 * ──────────────────────────
 * Defines sequenced curriculum paths (Onboarding, Role Mastery, Compliance,
 * Leadership) with completion gates.
 */
const TrainingPathItemSchema = new mongoose.Schema(
  {
    reelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyReel",
      required: true,
    },
    sequenceOrder: { type: Number, required: true },
    requiredQuizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyQuizQuestion",
      default: null,
    },
    required: { type: Boolean, default: true },
  },
  { _id: false }
);

const CompanyTrainingPathSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    type: {
      type: String,
      enum: ["onboarding", "role", "compliance", "skill", "refresher"],
      default: "role",
      index: true,
    },
    roleScope: [{ type: String, trim: true }],
    departmentScope: [{ type: String, trim: true }],
    required: { type: Boolean, default: true },
    recurrenceRule: {
      type: String,
      enum: ["once", "monthly", "quarterly", "annual"],
      default: "once",
    },
    items: [TrainingPathItemSchema],
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompanyTrainingPath", CompanyTrainingPathSchema);
