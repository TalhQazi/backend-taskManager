const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
    authorId: { type: String, default: "" },
    authorName: { type: String, default: "" },
    authorRole: { type: String, default: "" },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    category: { type: String, default: "general" },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "expired", "archived"],
      default: "draft",
      index: true,
    },
    scheduledAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    pinned: { type: Boolean, default: false },
    emergency: { type: Boolean, default: false },
    requiresAcknowledgement: { type: Boolean, default: false },
    sendPushNotification: { type: Boolean, default: true },
    sendEmail: { type: Boolean, default: false },
    sendSMS: { type: Boolean, default: false },
    repeatFrequency: {
      type: String,
      enum: ["none", "daily", "weekly"],
      default: "none",
    },
    attachments: { type: Array, default: [] },
    targetSummary: { type: String, default: "Everyone" },
    sentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AnnouncementSchema.index({ status: 1, createdAt: -1 });
AnnouncementSchema.index({ pinned: -1, createdAt: -1 });

module.exports = mongoose.model("Announcement", AnnouncementSchema);
