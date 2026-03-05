const mongoose = require("mongoose");

const ComplianceFlagSchema = new mongoose.Schema(
  {
    employee: { type: String, required: true },
    userId: { type: String, default: "" },
    timeEntryId: { type: String, default: "" },

    type: {
      type: String,
      required: true,
      enum: ["meal_break", "overtime", "off_the_clock", "hard_stop"],
    },

    severity: { type: String, enum: ["warning", "violation"], default: "violation" },
    status: { type: String, enum: ["open", "resolved"], default: "open" },

    ruleStateCode: { type: String, default: "" },

    message: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    detectedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    resolvedByUserId: { type: String, default: "" },
  },
  { timestamps: true }
);

ComplianceFlagSchema.index({ status: 1, detectedAt: -1 });
ComplianceFlagSchema.index({ employee: 1, detectedAt: -1 });

module.exports = mongoose.model("ComplianceFlag", ComplianceFlagSchema);
