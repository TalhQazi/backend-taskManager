const mongoose = require("mongoose");

const TimeEntrySchema = new mongoose.Schema(
  {
    employee: { type: String, required: true },
    avatar: { type: String, default: "" },
    date: { type: Date, required: true },
    clockIn: { type: String, default: "" },
    clockOut: { type: String, default: "" },
    breakTime: { type: String, default: "" },
    totalHours: { type: Number, default: 0 },
    status: { type: String, enum: ["complete", "incomplete", "overtime"], default: "complete" },
    location: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TimeEntry", TimeEntrySchema);
