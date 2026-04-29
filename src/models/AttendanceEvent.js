const mongoose = require("mongoose");

const AttendanceEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    employeeName: { type: String, required: true, index: true },

    type: {
      type: String,
      enum: ["call_out", "late_arrival", "missed_clock_in", "late_call_out"],
      required: true,
      index: true,
    },

    date: { type: Date, required: true, index: true },
    shiftStart: { type: String, default: "" },
    shiftEnd: { type: String, default: "" },
    timezone: { type: String, default: "America/New_York" },

    level: { type: Number, enum: [1, 2, 3, 4], default: 1 },
    minutesLate: { type: Number, default: 0 },

    reasonCode: { type: String, default: "" },
    reasonText: { type: String, default: "" },

    explanation: {
      reason: { type: String, default: "" },
      comments: { type: String, default: "" },
      submittedAt: { type: Date },
    },

    attachments: {
      type: [
        {
          fileName: { type: String, default: "" },
          url: { type: String, default: "" },
          mimeType: { type: String, default: "" },
          size: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    status: { type: String, enum: ["open", "reviewed", "archived"], default: "open" },
    deviceInfo: { type: String }, // mobile or web
    ipAddress: { type: String },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    managerNotes: { type: String, default: "" },

    metadata: {
      device: { type: String, default: "" },
      ipAddress: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

AttendanceEventSchema.index({ userId: 1, date: -1, type: 1 });
AttendanceEventSchema.index({ status: 1, type: 1, date: -1 });

module.exports = mongoose.model("AttendanceEvent", AttendanceEventSchema);
