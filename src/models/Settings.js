const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    fullName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: { type: String, default: "" },
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      taskAlerts: { type: Boolean, default: true },
      employeeUpdates: { type: Boolean, default: true },
      weeklyReports: { type: Boolean, default: false },
    },
    language: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", SettingsSchema);
