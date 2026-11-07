const mongoose = require("mongoose");

const alertRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    targetType: { type: String, enum: ["WEBSITE", "SERVER"], required: true },
    condition: { type: String, enum: ["DOWN", "DEGRADED", "SSL_EXPIRING", "HIGH_CPU", "HIGH_MEMORY", "HIGH_DISK"], required: true },
    threshold: { type: Number }, // e.g. 90 for 90% CPU, or 7 for 7 days until SSL expiry
    durationMinutes: { type: Number, default: 0 }, // Must be in condition for X minutes before alerting
    isEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AlertRule", alertRuleSchema);
