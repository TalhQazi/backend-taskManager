const mongoose = require("mongoose");

const ChatGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "", trim: true },
    avatarUrl: { type: String, default: "" },
    groupType: {
      type: String,
      enum: ["custom", "department", "project", "task"],
      default: "custom",
      index: true,
    },
    isPrivate: { type: Boolean, default: false },
    announcementOnly: { type: Boolean, default: false }, // Only admins can post
    createdBy: { type: String, required: true },
    creatorRole: { type: String, default: "admin" },
    members: [{ type: String, index: true }], // Employee names or User IDs
    admins: [{ type: String }], // Group Admin names or User IDs
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", index: true },
    department: { type: String, default: "", index: true },
    isArchived: { type: Boolean, default: false, index: true },
    pinnedMessageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
  },
  { timestamps: true }
);

// Compound indexes for group discovery & user membership queries
ChatGroupSchema.index({ members: 1, isArchived: 1 });
ChatGroupSchema.index({ groupType: 1, department: 1 });
ChatGroupSchema.index({ projectId: 1 });
ChatGroupSchema.index({ taskId: 1 });

module.exports = mongoose.model("ChatGroup", ChatGroupSchema);
