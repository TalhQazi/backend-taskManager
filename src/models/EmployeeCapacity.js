const mongoose = require("mongoose");

/**
 * Planned working capacity per employee, for the Workload view.
 * Additive: absent capacity → Workload falls back to task counts only.
 */
const EmployeeCapacitySchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    employeeName: { type: String, default: "" },
    weeklyHours: { type: Number, default: 40, min: 0 },
    dailyHours: { type: Number, default: 8, min: 0 },
    // Default estimate applied to a task with no explicit estimate (hours).
    defaultTaskHours: { type: Number, default: 4, min: 0 },
    effectiveFrom: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

EmployeeCapacitySchema.index({ employeeId: 1, effectiveFrom: -1 });

module.exports = mongoose.models.EmployeeCapacity || mongoose.model("EmployeeCapacity", EmployeeCapacitySchema);
