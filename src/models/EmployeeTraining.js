const mongoose = require("mongoose");

/**
 * EmployeeTraining Schema
 * ───────────────────────
 * Tracks professional licenses, safety training, onboarding compliance,
 * technical certifications, and renewal deadlines with evidence document links.
 */
const EmployeeTrainingSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["certification", "license", "training", "safety", "compliance", "workshop", "other"],
      default: "certification",
      index: true,
    },
    issuingAuthority: { type: String, default: "" },
    credentialId: { type: String, default: "" },
    completionDate: { type: Date, default: null },
    issueDate: { type: Date, default: null },
    expirationDate: { type: Date, default: null, index: true },
    doesNotExpire: { type: Boolean, default: false },
    score: { type: String, default: "" },
    evidenceFileUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "expiring_soon", "expired", "in_progress", "scheduled"],
      default: "active",
      index: true,
    },
    notes: { type: String, default: "" },
    recordedBy: { type: String, default: "" },
    reminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

EmployeeTrainingSchema.index({ employeeId: 1, status: 1 });
EmployeeTrainingSchema.index({ expirationDate: 1 });

module.exports = mongoose.model("EmployeeTraining", EmployeeTrainingSchema);
