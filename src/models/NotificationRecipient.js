const mongoose = require("mongoose");

const notificationRecipientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationRecipient", notificationRecipientSchema);
