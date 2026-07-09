const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    companyName: { type: String, default: "" },
    supportEmail: { type: String, default: "" },
    notificationsEnabled: { type: Boolean, default: true },
    autoLogoutMinutes: { type: Number, default: 0 },
    fullName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: { type: String, default: "" },
    // Work information fields
    department: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    manager: { type: String, default: "" },
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      taskAlerts: { type: Boolean, default: true },
      employeeUpdates: { type: Boolean, default: true },
      weeklyReports: { type: Boolean, default: false },
    },
    emailPreferences: {
      taskAssignment: { type: Boolean, default: true },
      projectAssignment: { type: Boolean, default: true },
      commentAdded: { type: Boolean, default: true },
      replyAdded: { type: Boolean, default: true },
      taskCompleted: { type: Boolean, default: true },
      eodMissAlert: { type: Boolean, default: true },
      eodComment: { type: Boolean, default: true },
      messageAlert: { type: Boolean, default: true },
      systemAlert: { type: Boolean, default: true },
      patentExpiration: { type: Boolean, default: true },
      complianceReminder: { type: Boolean, default: true },
      userRegistration: { type: Boolean, default: true },
    },
    webPreferences: {
      taskAssignment: { type: Boolean, default: true },
      projectAssignment: { type: Boolean, default: true },
      commentAdded: { type: Boolean, default: true },
      replyAdded: { type: Boolean, default: true },
      taskCompleted: { type: Boolean, default: true },
      eodMissAlert: { type: Boolean, default: true },
      eodComment: { type: Boolean, default: true },
      messageAlert: { type: Boolean, default: true },
      systemAlert: { type: Boolean, default: true },
      patentExpiration: { type: Boolean, default: true },
      complianceReminder: { type: Boolean, default: true },
      userRegistration: { type: Boolean, default: true },
    },
    language: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    countryCode: { type: String, default: "US" },
    avatarUrl: { type: String, default: "" },
    avatarDataUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

SettingsSchema.index({ email: 1 });

module.exports = mongoose.model("Settings", SettingsSchema);
