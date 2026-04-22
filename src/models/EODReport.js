const mongoose = require("mongoose");

const eodReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    date: {
      type: Date,
      required: true,
      index: true,
    },
    rawInput: {
      type: String,
      required: true,
    },
    inputType: {
      type: String,
      enum: ["text", "voice"],
      default: "text",
    },
    status: {
      type: String,
      enum: ["submitted", "missing", "late"],
      default: "submitted",
    },
    // For Phase 2 - AI processing
    aiSummary: {
      type: String,
    },
    productivityScore: {
      type: Number,
      min: 0,
      max: 10,
    },
    flags: [{
      type: String,
    }],
    // Reference to time entry
    timeEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimeEntry",
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
eodReportSchema.index({ userId: 1, date: -1 });
eodReportSchema.index({ employeeId: 1, date: -1 });
eodReportSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model("EODReport", eodReportSchema);
