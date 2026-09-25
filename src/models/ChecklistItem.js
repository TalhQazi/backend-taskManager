const mongoose = require("mongoose");

const checklistItemSchema = new mongoose.Schema(
  {
    websiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Website",
      required: true,
      index: true,
    },
    category: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "in-progress", "completed", "blocked"],
      default: "pending",
      index: true,
    },
    completedBy: { type: String, default: "" }, // username
    completedAt: { type: Date },
    blockedReason: { type: String, default: "" },
    requiresEvidence: { type: Boolean, default: false },
    evidenceUrl: { type: String, default: "" },
    evidenceFile: {
      fileName: String,
      fileUrl: String, // base64 representation or S3 url
      mimeType: String,
      size: Number,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChecklistItem", checklistItemSchema);
