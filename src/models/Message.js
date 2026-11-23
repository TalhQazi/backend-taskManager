const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    sender: { type: String, required: true, index: true },
    senderAvatar: { type: String, default: "" },
    recipient: { type: String, default: "", index: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatGroup", index: true },
    parentMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", index: true },
    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date },
    audience: { type: String, default: "" },
    content: { type: String, default: "" },
    timestamp: { type: String, required: true },
    createdAt: { type: String, default: "" },
    type: {
      type: String,
      enum: ["direct", "broadcast", "group", "task_card", "voice_note", "system"],
      required: true,
      index: true,
    },
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    readBy: [{ type: String }],
    deliveredTo: [
      {
        username: { type: String },
        deliveredAt: { type: Date, default: Date.now },
      },
    ],
    assignees: [{ type: String }],
    reactions: [
      {
        emoji: { type: String, required: true },
        username: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Single attachment for backwards compatibility
    attachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    // Multi-file attachment support
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
      },
    ],
    // Voice note metadata
    voiceNote: {
      url: { type: String, default: "" },
      duration: { type: Number, default: 0 }, // seconds
      waveform: [{ type: Number }], // visual audio frequencies
    },
    // Embedded Task Card metadata
    taskCard: {
      taskId: { type: String, default: "" },
      title: { type: String, default: "" },
      status: { type: String, default: "" },
      priority: { type: String, default: "" },
      dueDate: { type: String, default: "" },
      assignees: [{ type: String }],
    },
    // Editing & Deletion status
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    // Pinned & Starred status
    isPinned: { type: Boolean, default: false, index: true },
    pinnedBy: { type: String, default: "" },
    starredBy: [{ type: String, index: true }],
    mentions: [
      {
        username: { type: String },
        type: { type: String, enum: ["user", "department", "everyone"], default: "user" },
      },
    ],
    meta: {
      resourceType: { type: String, default: "" },
      resourceId: { type: String, default: "" },
      link: { type: String, default: "" },
      category: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Compound indexes for optimal performance
MessageSchema.index({ recipient: 1, status: 1 });
MessageSchema.index({ groupId: 1, createdAt: -1 });
MessageSchema.index({ parentMessageId: 1, createdAt: 1 });
MessageSchema.index({ type: 1, updatedAt: -1 });
MessageSchema.index({ sender: 1, updatedAt: -1 });
MessageSchema.index({ content: "text" });

module.exports = mongoose.model("Message", MessageSchema);
