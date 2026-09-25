const mongoose = require("mongoose");

const AnnouncementAuditLogSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "" },
    userRole: { type: String, default: "" },

    action: {
      type: String,
      enum: ["created", "updated", "deleted", "archived", "published", "scheduled"],
      required: true,
      index: true,
    },

    changes: { type: mongoose.Schema.Types.Mixed, default: {} }, // Track what changed
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

AnnouncementAuditLogSchema.index({ announcementId: 1, action: 1 });
AnnouncementAuditLogSchema.index({ userId: 1, createdAt: -1 });
AnnouncementAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AnnouncementAuditLog", AnnouncementAuditLogSchema);
