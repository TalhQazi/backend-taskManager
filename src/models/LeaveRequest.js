const mongoose = require("mongoose");

const leaveRequestSchema = new mongoose.Schema(
  {
    employeeName: { type: String, required: true },
    type: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reason: { type: String, default: "" },
    exemptFromEOD: { type: Boolean, default: false },
    approvedAt: { type: Date },
    approvedBy: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
