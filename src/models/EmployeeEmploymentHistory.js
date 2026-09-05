const mongoose = require("mongoose");

/**
 * EmployeeEmploymentHistory Schema
 * ────────────────────────────────
 * Tracks effective-dated employment events (hires, promotions, transfers,
 * title changes, wage changes, status updates, rehires, and separations)
 * so career history is preserved permanently.
 */
const EmployeeEmploymentHistorySchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    effectiveDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    changeType: {
      type: String,
      enum: [
        "hire",
        "promotion",
        "transfer",
        "title_change",
        "department_change",
        "location_change",
        "supervisor_change",
        "compensation_change",
        "status_change",
        "rehire",
        "separation",
        "other",
      ],
      required: true,
    },
    title: { type: String, default: "" },
    department: { type: String, default: "" },
    location: { type: String, default: "" },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    supervisor: { type: String, default: "" },
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    payType: { type: String, enum: ["hourly", "monthly", "annual", ""], default: "" },
    payRate: { type: String, default: "" },
    status: { type: String, default: "" },
    previousValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    newValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    reason: { type: String, default: "" },
    notes: { type: String, default: "" },
    changedBy: { type: String, default: "system" },
    changedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

EmployeeEmploymentHistorySchema.index({ employeeId: 1, effectiveDate: -1 });

module.exports = mongoose.model("EmployeeEmploymentHistory", EmployeeEmploymentHistorySchema);
