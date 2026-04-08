const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema(
  {
    day: { type: String, enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], required: true, index: true },
    title: { type: String, required: true },
    assignee: { type: String, required: true, index: true },
    location: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    type: { type: String, enum: ["task", "meeting", "break", "training"], required: true },
  },
  { timestamps: true }
);

// Compound index for schedule lookups
EventSchema.index({ assignee: 1, day: 1 });

module.exports = mongoose.model("Event", EventSchema);
