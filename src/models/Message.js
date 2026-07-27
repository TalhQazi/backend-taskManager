const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    sender: { type: String, required: true, index: true },
    senderAvatar: { type: String, default: "" },
    recipient: { type: String, required: true, index: true },
    audience: { type: String, default: "" },
    content: { type: String, required: true },
    timestamp: { type: String, required: true },
    createdAt: { type: String, default: "" },
    type: { type: String, enum: ["direct", "broadcast"], required: true, index: true },
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    readBy: [{ type: String }],
    assignees: [{ type: String }],
    reactions: [
      {
        emoji: { type: String, required: true },
        username: { type: String, required: true },
      },
    ],
    attachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    meta: {
      resourceType: { type: String, default: "" },
      resourceId: { type: String, default: "" },
      link: { type: String, default: "" },
      category: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Compound indexes for common queries
MessageSchema.index({ recipient: 1, status: 1 });
MessageSchema.index({ type: 1, updatedAt: -1 });
MessageSchema.index({ sender: 1, updatedAt: -1 });

module.exports = mongoose.model("Message", MessageSchema);
