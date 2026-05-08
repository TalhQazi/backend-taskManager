const mongoose = require("mongoose");

const SystemSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    emailConfig: {
      host: { type: String, default: "" },
      port: { type: Number, default: 587 },
      user: { type: String, default: "" },
      pass: { type: String, default: "" },
      secure: { type: Boolean, default: false },
      fromAddress: { type: String, default: "" },
    },
    templates: {
      userRegistration: {
        enabled: { type: Boolean, default: false },
        subject: { type: String, default: "Welcome to Task Manager" },
        body: { type: String, default: "Hello {name},\n\nWelcome to our platform. Your account has been created successfully." },
      },
      managerRegistration: {
        enabled: { type: Boolean, default: false },
        subject: { type: String, default: "Manager Account Created" },
        body: { type: String, default: "Hello {name},\n\nYour manager account has been created. You can now login to manage tasks." },
      },
      forgotPassword: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "Reset Your Password" },
        body: { type: String, default: "Hello {name},\n\nYou requested a password reset. Please use the following code: {code}" },
      },
    },
    taskRewardSystemEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SystemSettingsSchema.index({ key: 1 });

module.exports = mongoose.model("SystemSettings", SystemSettingsSchema);
