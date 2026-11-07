const mongoose = require("mongoose");

/**
 * ManagerBroadcast Schema
 * ────────────────────────
 * Priority video messages or urgent executive broadcasts injected
 * at the top of the feed for targeted employees.
 */
const ManagerBroadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    mediaUrl: { type: String, required: true, trim: true },
    thumbnailUrl: { type: String, default: "", trim: true },
    targetScope: {
      type: String,
      enum: ["all", "role", "department", "location", "individual"],
      default: "all",
      index: true,
    },
    targetValues: [{ type: String, trim: true }],
    priority: {
      type: String,
      enum: ["normal", "urgent"],
      default: "urgent",
      index: true,
    },
    publishAt: { type: Date, default: Date.now },
    expireAt: { type: Date, default: null, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requiresAcknowledgment: {
      type: Boolean,
      default: true,
    },
    acknowledgedBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        acknowledgedAt: {
          type: Date,
          default: Date.now,
        },
        note: { type: String, default: "" },
      },
    ],
    status: {
      type: String,
      enum: ["active", "expired", "draft"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ManagerBroadcast", ManagerBroadcastSchema);
