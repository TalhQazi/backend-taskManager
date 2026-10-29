const mongoose = require("mongoose");

const themeScheduleSchema = new mongoose.Schema(
  {
    themeKey: {
      type: String,
      required: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    scheduleType: {
      type: String,
      enum: ["fixedAnnual", "calculated", "range"],
      default: "range",
      required: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    // For fixedAnnual recurrence (e.g., month 10 day 15 to month 11 day 2)
    annualMonthDay: {
      startMonth: { type: Number, min: 1, max: 12 },
      startDay: { type: Number, min: 1, max: 31 },
      endMonth: { type: Number, min: 1, max: 12 },
      endDay: { type: Number, min: 1, max: 31 },
    },
    timezone: {
      type: String,
      default: "UTC",
    },
    priority: {
      type: Number,
      default: 10,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

themeScheduleSchema.index({ isActive: 1, priority: -1 });

const ThemeSchedule = mongoose.model("ThemeSchedule", themeScheduleSchema);

module.exports = ThemeSchedule;
