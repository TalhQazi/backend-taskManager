const mongoose = require("mongoose");

const ViolationNotificationSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    employee: { type: String, required: true },
    timeEntryId: { type: String, default: "" },
    complianceFlagId: { type: String, default: "" },

    type: { type: String, enum: ["meal_break_warning", "violation"], required: true },
    message: { type: String, default: "" },

    deliveredAt: { type: Date },
    readAt: { type: Date },
  },
  { timestamps: true }
);

ViolationNotificationSchema.index({ employee: 1, createdAt: -1 });

module.exports = mongoose.model("ViolationNotification", ViolationNotificationSchema);
