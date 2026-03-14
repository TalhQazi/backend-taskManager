const mongoose = require("mongoose");

const AsanaAttachmentSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    taskAsanaId: { type: String, required: true, index: true },
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaAttachment", AsanaAttachmentSchema);
