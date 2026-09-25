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
        "start_lunch",
        "end_lunch",
        "start_break",
        "end_break",
        "late_return",
        "auto_expire",
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

// Post-save hook to trigger centralized notifications for operational actions
ActivityLogSchema.post("save", async function (doc) {
  try {
    // 1. Skip login/logout notifications
    if (doc.action && doc.action.startsWith("AUTH_")) {
      return;
    }
    // 2. Skip authentication / session resource types
    if (doc.resourceType === "auth") {
      return;
    }
    // 3. Skip task and project creation notifications
    if (
      doc.action === "TASK_CREATE" ||
      doc.action === "PROJECT_CREATE" ||
      ((doc.resourceType === "task" || doc.resourceType === "project") &&
        doc.action &&
        (doc.action.toLowerCase().includes("create") || doc.action.toLowerCase().includes("created")))
    ) {
      return;
    }

    const { createNotification } = require("../utils/notifications");

    await createNotification({
      actor: doc.actorUsername,
      actorRole: doc.actorRole,
      action: doc.action.toLowerCase().replace(/_/g, " "),
      resourceType: doc.resourceType,
      resourceName: doc.resourceName,
      details: doc.description,
      resourceId: doc.resourceId,
      category: "SYSTEM_ALERT",
    });
  } catch (err) {
    console.error("Error in ActivityLog post-save notification hook:", err);
  }
});

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
