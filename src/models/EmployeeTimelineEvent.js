const mongoose = require("mongoose");

/**
 * EmployeeTimelineEvent Schema
 * ────────────────────────────
 * Clean, human-readable business milestones and timeline events
 * for the employee's career progression (hires, transfers, promotions,
 * training completion, document submissions, asset issuance, etc.).
 */
const EmployeeTimelineEventSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "created",
        "profile_updated",
        "department_changed",
        "title_changed",
        "location_changed",
        "supervisor_changed",
        "status_changed",
        "compensation_updated",
        "document_uploaded",
        "document_replaced",
        "asset_assigned",
        "asset_returned",
        "training_completed",
        "certification_added",
        "change_request_submitted",
        "change_request_approved",
        "onboarding_approved",
        "separation",
        "rehire",
        "note_added",
        "other",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    eventDate: { type: Date, default: Date.now, required: true, index: true },
    actorId: { type: String, default: "system" },
    actorName: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

EmployeeTimelineEventSchema.index({ employeeId: 1, eventDate: -1 });

module.exports = mongoose.model("EmployeeTimelineEvent", EmployeeTimelineEventSchema);
