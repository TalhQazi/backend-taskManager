const mongoose = require("mongoose");

// Lab testing, UL listing, permits, certifications, and retesting steps.
// Each requirement may sync to a cost line item so its cost rolls into the
// projected prototype total and build readiness.
const CertificationRequirementSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    costSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "CostSheet", required: true, index: true },
    // Paired cost line item (created automatically when cost is tracked).
    lineItemId: { type: mongoose.Schema.Types.ObjectId, ref: "CostLineItem", default: null },

    requirementType: {
      type: String,
      enum: ["lab_testing", "ul_listing", "permit", "certification", "retesting"],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    authorityOrLab: { type: String, default: "" },
    standard: { type: String, default: "" }, // e.g. NIJ, ASTM, ISO, UL category
    status: {
      type: String,
      enum: ["planned", "quoted", "submitted", "in_progress", "passed", "failed", "approved", "expired"],
      default: "planned",
      index: true,
    },
    requiredForPrototype: { type: Boolean, default: true },

    estimatedCostCents: { type: Number, default: 0, min: 0 },
    paidCents: { type: Number, default: 0, min: 0 },

    dueDate: { type: Date, default: null },
    filingDate: { type: Date, default: null },
    approvalDate: { type: Date, default: null },
    expirationDate: { type: Date, default: null },
    result: { type: String, default: "" },
    notes: { type: String, default: "" },
    // Set once the near-due-date alert fires so the cron doesn't repeat it.
    dueAlertSentAt: { type: Date, default: null },

    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
  },
  { timestamps: true }
);

CertificationRequirementSchema.index({ projectId: 1, status: 1 });
CertificationRequirementSchema.index({ dueDate: 1 });

module.exports = mongoose.model("CertificationRequirement", CertificationRequirementSchema);
