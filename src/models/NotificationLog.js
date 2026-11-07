const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    recipientEmail: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String },
    status: { type: String, enum: ["SENT", "FAILED"], required: true },
    errorDetails: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
