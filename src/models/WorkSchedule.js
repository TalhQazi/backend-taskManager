const mongoose = require("mongoose");

const WorkScheduleSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    locationId: { type: String, default: "", index: true },
    shiftStart: { type: String, required: true }, // HH:MM
    shiftEnd: { type: String, required: true }, // HH:MM
    timezone: { type: String, default: "America/New_York" },
    eodOffsetMinutes: { type: Number, default: -10 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

WorkScheduleSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model("WorkSchedule", WorkScheduleSchema);
