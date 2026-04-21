const mongoose = require("mongoose");

const ProjectCommentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    authorUserId: { type: String, default: "" },
    authorUsername: { type: String, default: "" },
    authorRole: { type: String, default: "" },
    message: { type: String, required: true },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Compound index for listing comments by project in order
ProjectCommentSchema.index({ projectId: 1, createdAt: 1 });

module.exports = mongoose.model("ProjectComment", ProjectCommentSchema);
