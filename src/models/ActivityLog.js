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
        "APPLIANCE_CREATE",
        "APPLIANCE_UPDATE",
        "APPLIANCE_DELETE",
        "VEHICLE_CREATE",
        "VEHICLE_UPDATE",
        "VEHICLE_DELETE",
        "LOCATION_CREATE",
        "LOCATION_UPDATE",
        "LOCATION_DELETE",
        "VENDOR_CREATE",
        "VENDOR_UPDATE",
        "VENDOR_DELETE",
        "EVENT_CREATE",
        "EVENT_UPDATE",
        "EVENT_DELETE",
        "ONBOARDING_CREATE",
        "ONBOARDING_UPDATE",
        "CLEARHIRE_SUBMIT",
        "CLEARHIRE_SCAN_COMPLETE",
        "CLEARHIRE_OVERRIDE",
        "CLEARHIRE_RECHECK",
        "PROJECT_ASSIGN",
        "PROJECT_REASSIGN",
        "PROJECT_CREATE",
        "PROJECT_UPDATE",
        "PROJECT_ARCHIVE",
        "PROJECT_COMMENT_CREATE",
        "OTHER"
      ]
    },
    resourceType: {
      type: String,
      required: true,
      enum: ["user", "task", "employee", "time-entry", "notification", "message", "settings", "system", "auth", "appliance", "vehicle", "location", "vendor", "event", "onboarding", "clearhire", "project"]
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
