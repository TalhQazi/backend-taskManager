const mongoose = require("mongoose");

const TimeEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    employee: { type: String, required: true },
    avatar: { type: String, default: "" },
    stateCode: { type: String, default: "" },
    hourlyRate: { type: Number, default: 0 },
    date: { type: Date, required: true },
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("TimeEntry", TimeEntrySchema);
