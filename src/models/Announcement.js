const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    body: { type: String, required: true }, // HTML rich text
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: "" },
    authorRole: { type: String, default: "" },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "expired", "archived"],
      default: "active",
      index: true,
    },

    // Scheduling
    scheduledAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, default: null, index: true },

    // Flags
    pinned: { type: Boolean, default: false, index: true },
    emergency: { type: Boolean, default: false, index: true },
    requiresAcknowledgement: { type: Boolean, default: false },

    // Delivery
    sendPushNotification: { type: Boolean, default: true },
    sendEmail: { type: Boolean, default: false },
    repeatFrequency: {
      type: String,
      enum: ["none", "daily", "weekly"],
      default: "none",
    },

    // Targeting — stored targets summary for quick display
    targetSummary: { type: String, default: "Everyone" },

    // Attachments (S3-based)
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // Category tag
    category: {
      type: String,
      enum: ["general", "policy", "training", "safety", "hr", "it", "operations"],
      default: "general",
      index: true,
    },

    // Analytics snapshot (updated on read events)
    sentCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    acknowledgedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AnnouncementSchema.index({ createdAt: -1 });
AnnouncementSchema.index({ status: 1, createdAt: -1 });
AnnouncementSchema.index({ priority: 1, status: 1 });
AnnouncementSchema.index({ title: "text" });

module.exports = mongoose.model("Announcement", AnnouncementSchema);
