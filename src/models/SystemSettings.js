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
      senderName: { type: String, default: "Task Manager" },
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
        subject: { type: String, default: "Action Required: New Task Assigned - {taskTitle}" },
        body: { type: String, default: "Greetings {name},\n\nA new task has been assigned to you in the system. Please review the details below to ensure timely completion.\n\n--------------------------------------------------\n📌 Task Title: {taskTitle}\n📁 Project: {projectName}\n⚡ Priority: {priority}\n📅 Due Date: {dueDate}\n--------------------------------------------------\n\nTask Overview:\n{description}\n\nTo update the status or add comments, please log in to the Task Management Portal.\n\nBest regards,\nSystem Administration" },
      },
      fileAttachment: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "Attachment Notification: {fileName} on {taskTitle}" },
        body: { type: String, default: "Hello {name},\n\nThis is an automated notification to inform you that a new file has been attached to a task you are associated with.\n\nTask: {taskTitle}\nFile Name: {fileName}\n\nYou can view and download the attachment by visiting the task details page.\n\nBest regards,\nTask Manager System" },
      },
      commentAdded: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "New Communication on {taskTitle}" },
        body: { type: String, default: "Hello {name},\n\nA new comment has been recorded on the task '{taskTitle}' by {authorName}.\n\nMessage Details:\n--------------------------------------------------\n{commentText}\n--------------------------------------------------\n\nPlease log in to respond or acknowledge this comment." },
      },
      replyAdded: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "Response/Mention: {taskTitle}" },
        body: { type: String, default: "Hello {name},\n\n{authorName} has mentioned you or replied to your activity on task '{taskTitle}'.\n\nContext:\n--------------------------------------------------\n{replyText}\n--------------------------------------------------\n\nPlease review this update at your earliest convenience." },
      },
      projectAssignment: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "Involvement Confirmation: Project {projectName}" },
        body: { type: String, default: "Hello {name},\n\nThis notification confirms that you have been officially assigned to the following project:\n\n--------------------------------------------------\n🏢 Project Name: {projectName}\n--------------------------------------------------\n\nBrief Description:\n{description}\n\nYou can now access all tasks, files, and communications associated with this project via your dashboard.\n\nThank you for your contribution." },
      },
      projectReassignment: {
        enabled: { type: Boolean, default: true },
        subject: { type: String, default: "Project Reassigned: {projectName}" },
        body: { type: String, default: "Hello {name},\n\nThe project '{projectName}' has been reassigned to you.\n\nPlease login to review your updated assignments." },
      },
    },
    taskRewardSystemEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SystemSettingsSchema.index({ key: 1 });

module.exports = mongoose.model("SystemSettings", SystemSettingsSchema);
