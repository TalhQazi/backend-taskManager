const mongoose = require("mongoose");

/**
 * ClearHire® Profile Schema
 * ─────────────────────────
 * Stores pre-employment screening data for the ClearHire® Risk Engine.
 * SSN is stored AES-256-GCM encrypted — never in plain text.
 *
 * Status flow: PENDING → GREEN | YELLOW | RED
 *   GREEN  = Verified, full access
 *   YELLOW = Requires admin review / override
 *   RED    = Automatic denial, no access
 */

const AddressHistorySchema = new mongoose.Schema(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date }, // null = current address
  },
  { _id: false }
);

const ClearHireProfileSchema = new mongoose.Schema(
  {
    // ── Linked records ──────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },

    // ── Applicant identity (Section 5 — Onboarding Workflow) ────────
    fullName: { type: String, required: true },
    dob: { type: Date, required: true },
    ssnEncrypted: { type: String, required: true }, // AES-256-GCM output

    // ── Address history (7–10 years) ────────────────────────────────
    addressHistory: {
      type: [AddressHistorySchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 1,
        message: "At least one address is required",
      },
    },

    // ── Verification documents ──────────────────────────────────────
    governmentIdUrl: { type: String, default: "" }, // S3 URL or base64
    selfieUrl: { type: String, default: "" }, // S3 URL or base64

    // ── FCRA Compliance (Section 10) ────────────────────────────────
    fcraConsentGiven: { type: Boolean, default: false },
    fcraConsentDate: { type: Date },

    // ── Risk Engine Output (Section 6) ──────────────────────────────
    riskScore: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PENDING", "GREEN", "YELLOW", "RED"],
      default: "PENDING",
      index: true,
    },
    flags: [{ type: String }], // e.g. ["Violent felony", "Fraud/theft"]

    // ── External API references (Section 7) ─────────────────────────
    checkrCandidateId: { type: String, default: "" },
    checkrReportId: { type: String, default: "" },
    nsopwResult: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Continuous monitoring (Section 11) ───────────────────────────
    lastChecked: { type: Date, default: Date.now },
    recheckCount: { type: Number, default: 0 },

    // ── Admin override (Section 15) ─────────────────────────────────
    adminOverride: {
      overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      overriddenAt: { type: Date },
      previousStatus: { type: String },
      reason: { type: String },
    },

    // ── Adverse action notices (Section 10) ─────────────────────────
    preAdverseActionSentAt: { type: Date },
    finalAdverseActionSentAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for common queries
ClearHireProfileSchema.index({ lastChecked: 1 });
ClearHireProfileSchema.index({ "adminOverride.overriddenBy": 1 });

module.exports = mongoose.model("ClearHireProfile", ClearHireProfileSchema);
