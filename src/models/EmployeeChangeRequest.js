const mongoose = require("mongoose");

/**
 * EmployeeChangeRequest Schema
 * ────────────────────────────
 * Self-service update requests submitted by employees (e.g. address change,
 * phone update, emergency contacts, banking info modification)
 * pending HR approval.
 */
const EmployeeChangeRequestSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    employeeName: { type: String, default: "" },
    requestType: {
      type: String,
      enum: ["personal_info", "address", "emergency_contacts", "banking_info", "other"],
      required: true,
      index: true,
    },
    currentData: { type: mongoose.Schema.Types.Mixed, default: {} },
    proposedData: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedByName: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

EmployeeChangeRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("EmployeeChangeRequest", EmployeeChangeRequestSchema);
