const mongoose = require("mongoose");

const LegalNotificationSchema = new mongoose.Schema({
  notificationNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  message: { type: String },\n  type: { type: String, enum: ["Alert", "Reminder", "System"], default: "System" },\n  isRead: { type: String, enum: ["Yes", "No"], default: "No" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalNotification", LegalNotificationSchema);
