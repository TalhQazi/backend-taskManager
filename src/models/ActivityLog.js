const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: String, required: true },
    actorUsername: { type: String, required: true },
    actorRole: { type: String, required: true },
    action: { 
      type: String, 
      required: true,
      enum: [
        "AUTH_LOGIN_SUCCESS",
        "AUTH_LOGIN_FAILURE",
        "AUTH_LOGOUT",
        "USER_CREATE",
        "USER_UPDATE",
        "USER_DELETE",
        "USER_ROLE_CHANGE",
        "TASK_CREATE",
        "TASK_UPDATE",
        "TASK_DELETE",
        "EMPLOYEE_CREATE",
        "EMPLOYEE_UPDATE",
        "EMPLOYEE_DELETE",
        "TIME_ENTRY_CREATE",
        "TIME_ENTRY_UPDATE",
        "TIME_ENTRY_DELETE",
        "NOTIFICATION_CREATE",
        "MESSAGE_SEND",
        "SETTINGS_UPDATE",
        "DATA_EXPORT",
        "OTHER"
      ]
    },
    resourceType: { 
      type: String, 
      required: true,
      enum: ["user", "task", "employee", "time-entry", "notification", "message", "settings", "system", "auth"]
    },
    resourceId: { type: String, default: "" },
    resourceName: { type: String, default: "" },
    description: { type: String, required: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Index for efficient querying
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ actorUserId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });
ActivityLogSchema.index({ resourceType: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
