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
      taskAssignment: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "New Task Assigned" },
        body: { type: String, default: "Hello {name},\n\nYou have been assigned a new task: {taskTitle}.\n\nPlease login to view details." },
      },
      fileAttachment: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "New File Attached to Task" },
        body: { type: String, default: "Hello {name},\n\nA new file '{fileName}' has been attached to the task '{taskTitle}'.\n\nPlease login to view it." },
      },
      commentAdded: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "New Comment on Task" },
        body: { type: String, default: "Hello {name},\n\nA new comment was added to the task '{taskTitle}' by {authorName}.\n\nComment: {commentText}\n\nPlease login to view it." },
      },
      replyAdded: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "New Reply to Your Comment" },
        body: { type: String, default: "Hello {name},\n\n{authorName} replied to your comment on task '{taskTitle}'.\n\nReply: {replyText}\n\nPlease login to view it." },
      },
    },
    taskRewardSystemEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SystemSettingsSchema.index({ key: 1 });

module.exports = mongoose.model("SystemSettings", SystemSettingsSchema);
