const mongoose = require("mongoose");

const StateLaborRuleSchema = new mongoose.Schema(
  {
    stateCode: { type: String, required: true, uppercase: true, trim: true },

    weeklyOvertimeThresholdHours: { type: Number, default: 40 },
    overtimeMultiplier: { type: Number, default: 1.5 },

    mealBreakRequiredAfterHours: { type: Number, default: 6 },
    mealBreakMinMinutes: { type: Number, default: 30 },
    mealBreakWarningAtHours: { type: Number, default: 5.5 },
  },
  { timestamps: true }
);

StateLaborRuleSchema.index({ stateCode: 1 }, { unique: true });

module.exports = mongoose.model("StateLaborRule", StateLaborRuleSchema);
