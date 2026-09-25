const mongoose = require("mongoose");

/**
 * CompanyReel Schema
 * ───────────────────
 * Represents short-form training, culture, leadership, or compliance videos
 * within the Company Reels™ engine.
 */
const CompanyReelSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    duration: { type: Number, default: 0 }, // in seconds (ideal 8–30s)
    mediaUrl: { type: String, required: true, trim: true },
    thumbnailUrl: { type: String, default: "", trim: true },
    category: {
      type: String,
      enum: ["training", "safety", "operations", "culture", "leadership", "compliance", "motivation"],
      default: "training",
      index: true,
    },
    tags: [{ type: String, trim: true }],
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
      index: true,
    },
    isMandatory: { type: Boolean, default: false, index: true },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    dueDate: { type: Date, default: null, index: true },
    applicableRoles: [{ type: String, trim: true }], // empty means all roles
    applicableDepartments: [{ type: String, trim: true }], // empty means all departments
    applicableLocations: [{ type: String, trim: true }], // empty means all locations
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyQuizQuestion",
      default: null,
    },
    allowSkip: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CompanyReelSchema.index({ status: 1, isMandatory: 1, priority: 1 });
CompanyReelSchema.index({ applicableRoles: 1 });
CompanyReelSchema.index({ applicableDepartments: 1 });

module.exports = mongoose.model("CompanyReel", CompanyReelSchema);
