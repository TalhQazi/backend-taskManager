const mongoose = require("mongoose");

const themeAuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["theme", "schedule", "asset", "org_settings", "user_preference", "system"],
      required: true,
    },
    targetKey: {
      type: String,
      default: "",
      index: true,
    },
    performedBy: {
      type: String,
      default: "system",
      index: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  }
);

const ThemeAuditLog = mongoose.model("ThemeAuditLog", themeAuditLogSchema);

module.exports = ThemeAuditLog;
