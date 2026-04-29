const mongoose = require("mongoose");

const leaveRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeName: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["pto", "vacation", "sick", "holiday", "unpaid", "other"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reason: {
      type: String,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    // EOD exemption flag
    exemptFromEOD: {
      type: Boolean,
      default: true, // Most leaves exempt from EOD
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient date range queries
leaveRequestSchema.index({ userId: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ status: 1, type: 1 });

// Static method to check if user is on leave (exempt from EOD)
leaveRequestSchema.statics.isUserOnLeave = async function(userId, date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const leave = await this.findOne({
    userId,
    status: "approved",
    exemptFromEOD: true,
    startDate: { $lte: endOfDay },
    endDate: { $gte: startOfDay },
  }).lean();

  return Boolean(leave);
};

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
