const mongoose = require("mongoose");

const NewHireReportSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    onboardingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Onboarding",
      required: true,
      index: true,
    },
    stateCode: {
      type: String,
      default: "ME",
      required: true,
      index: true,
    },
    employeeName: {
      type: String,
      required: true,
    },
    employeeAddress: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zip: { type: String, default: "" },
    },
    ssnEncrypted: {
      type: String,
      required: true,
    },
    hireDate: {
      type: Date,
      required: true,
    },
    employerName: {
      type: String,
      required: true,
    },
    employerAddress: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zip: { type: String, default: "" },
    },
    employerFEIN: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "submitted", "failed", "overridden"],
      default: "pending",
      index: true,
    },
    attemptsCount: {
      type: Number,
      default: 0,
    },
    confirmationId: {
      type: String,
      default: "",
    },
    countdownExpiry: {
      type: Date,
      required: true,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
    },
    errorMessage: {
      type: String,
      default: "",
    },
    overrideReason: {
      type: String,
      default: "",
    },
    overrideBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    overrideAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Composite indexes for reports management
NewHireReportSchema.index({ status: 1, countdownExpiry: 1 });

module.exports = mongoose.model("NewHireReport", NewHireReportSchema);
