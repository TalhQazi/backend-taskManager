const mongoose = require("mongoose");

const PollCommentAttachmentSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, default: "" },
  uploadedAt: { type: Date, default: Date.now }
});

const PollCommentSchema = new mongoose.Schema(
  {
    pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    commentText: { type: String, required: true },
    attachments: [PollCommentAttachmentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("PollComment", PollCommentSchema);
