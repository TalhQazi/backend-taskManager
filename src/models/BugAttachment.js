const mongoose = require("mongoose");

const BugAttachmentSchema = new mongoose.Schema(
  {
    bugId: { type: mongoose.Schema.Types.ObjectId, ref: "BugReport", required: true, index: true },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: "BugComment", default: null, index: true },
    fileName: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    resolution: { type: String, default: "" },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    codec: { type: String, default: "" },
    compressedSize: { type: Number, default: 0 },
    checksum: { type: String, default: "" },
    processingStatus: { type: String, enum: ["pending", "processing", "completed", "failed"], default: "completed" },
    uploadedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugAttachment", BugAttachmentSchema);
