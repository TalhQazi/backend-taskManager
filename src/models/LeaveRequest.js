const mongoose = require("mongoose");

const LeaveRequestSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    employeeName: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["pto", "vacation", "sick", "holiday", "unpaid", "other"],
      default: "pto",
      index: true,
    },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reason: { type: String, default: "" },
    exemptFromEOD: { type: Boolean, default: false },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

LeaveRequestSchema.index({ employeeId: 1, createdAt: -1 });
LeaveRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("LeaveRequest", LeaveRequestSchema);
