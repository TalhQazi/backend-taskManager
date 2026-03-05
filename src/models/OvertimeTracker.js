const mongoose = require("mongoose");

const OvertimeTrackerSchema = new mongoose.Schema(
  {
    employee: { type: String, required: true },
    userId: { type: String, default: "" },

    weekStart: { type: String, required: true },
    weekEnd: { type: String, required: true },

    totalHours: { type: Number, default: 0 },
    regularHours: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },

    hourlyRate: { type: Number, default: 0 },
    overtimeRate: { type: Number, default: 0 },
  },
  { timestamps: true }
);

OvertimeTrackerSchema.index({ employee: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model("OvertimeTracker", OvertimeTrackerSchema);
