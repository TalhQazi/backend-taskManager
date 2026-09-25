const mongoose = require("mongoose");

const LegalNotificationSchema = new mongoose.Schema({
  notificationNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  message: { type: String },
  type: { type: String, enum: ["Alert", "Reminder", "System"], default: "System" },
  isRead: { type: String, enum: ["Yes", "No"], default: "No" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalNotification", LegalNotificationSchema);
