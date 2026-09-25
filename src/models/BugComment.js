const mongoose = require("mongoose");

const BugCommentSchema = new mongoose.Schema(
  {
    bugId: { type: mongoose.Schema.Types.ObjectId, ref: "BugReport", required: true, index: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userRole: { type: String, default: "" },
    userAvatarUrl: { type: String, default: "" },
    content: { type: String, maxlength: 10000, default: "" },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        duration: { type: Number, default: 0 },
        resolution: { type: String, default: "" },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        codec: { type: String, default: "" },
        compressedSize: { type: Number, default: 0 },
        checksum: { type: String, default: "" },
        processingStatus: { type: String, default: "completed" },
      },
    ],
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    mentions: [{ type: String }],
    reactions: [
      {
        emoji: { type: String, required: true },
        users: [{ type: String }],
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugComment", BugCommentSchema);
