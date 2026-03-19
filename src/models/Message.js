const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    sender: { type: String, required: true },
    senderAvatar: { type: String, default: "" },
    recipient: { type: String, required: true },
    audience: { type: String, default: "" },
    content: { type: String, required: true },
    timestamp: { type: String, required: true },
    createdAt: { type: String, default: "" },
    type: { type: String, enum: ["direct", "broadcast"], required: true },
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    meta: {
      resourceType: { type: String, default: "" },
      resourceId: { type: String, default: "" },
      link: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", MessageSchema);
