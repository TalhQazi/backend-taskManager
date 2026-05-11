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
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      taskAlerts: { type: Boolean, default: true },
      employeeUpdates: { type: Boolean, default: true },
      weeklyReports: { type: Boolean, default: false },
    },
    language: { type: String, default: "en" },
    timezone: { type: String, default: "UTC" },
    avatarUrl: { type: String, default: "" },
    avatarDataUrl: { type: String, default: "" },
    // Bank & Direct Deposit (encrypted)
    bankAccountLast4: { type: String, default: "" },
    bankRoutingLast4: { type: String, default: "" },
    bankName: { type: String, default: "" },
    directDepositEnabled: { type: Boolean, default: false },
    bankAccountEncrypted: { type: String, default: "" },
    bankRoutingEncrypted: { type: String, default: "" },
    // Emergency Contact
    emergencyContactName: { type: String, default: "" },
    emergencyContactPhone: { type: String, default: "" },
    emergencyContactRelation: { type: String, default: "" },
    // Tax Withholding (W-4)
    filingStatus: { type: String, default: "" },
    allowances: { type: Number, default: 0 },
    additionalWithholding: { type: Number, default: 0 },
    // MFA
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: "" },
    mfaBackupCodes: { type: String, default: "" },
  },
  { timestamps: true }
);

SettingsSchema.index({ email: 1 });

module.exports = mongoose.model("Settings", SettingsSchema);
