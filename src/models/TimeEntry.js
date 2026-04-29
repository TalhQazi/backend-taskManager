const mongoose = require("mongoose");

const TimeEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    employee: { type: String, required: true, index: true },
    avatar: { type: String, default: "" },
    stateCode: { type: String, default: "" },
    hourlyRate: { type: Number, default: 0 },
    date: { type: Date, required: true, index: true },
    clockIn: { type: String, default: "" },
    clockOut: { type: String, default: "" },
    breakTime: { type: String, default: "" },
    clockInAt: { type: Date },
    clockOutAt: { type: Date },
    breaks: {
      type: [
        {
          type: {
            type: String,
            enum: ["meal", "rest"],
            default: "meal",
          },
          startAt: { type: Date },
          endAt: { type: Date },
        },
      ],
      default: [],
    },
    totalHours: { type: Number, default: 0 },
    status: { type: String, enum: ["complete", "incomplete", "overtime"], default: "complete" },
    location: { type: String, default: "" },
    scrum: { type: String, default: "" },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
TimeEntrySchema.index({ employee: 1, date: -1 });
TimeEntrySchema.index({ userId: 1, date: -1 });
TimeEntrySchema.index({ date: -1, status: 1 });

module.exports = mongoose.model("TimeEntry", TimeEntrySchema);
