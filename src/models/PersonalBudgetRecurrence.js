const mongoose = require("mongoose");

const PersonalBudgetRecurrenceSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: ["monthly", "weekly", "biweekly", "quarterly", "annually", "custom"],
      required: true,
    },
    dayOfMonth: { type: Number, default: 1 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    autoCreateNextPeriod: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PersonalBudgetRecurrence", PersonalBudgetRecurrenceSchema);
