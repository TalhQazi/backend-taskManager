const mongoose = require("mongoose");

const PollNotificationSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, default: "" },
    channel: {
      type: String,
      enum: ["in_app", "email", "push", "sms"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "read"],
      default: "pending",
    },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

PollNotificationSchema.index({ pollId: 1, userId: 1, channel: 1 });

module.exports = mongoose.model("PollNotification", PollNotificationSchema);
