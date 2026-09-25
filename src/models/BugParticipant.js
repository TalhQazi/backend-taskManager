const mongoose = require("mongoose");

const BugParticipantSchema = new mongoose.Schema(
  {
    bugId: { type: mongoose.Schema.Types.ObjectId, ref: "BugReport", required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    lastReadAt: { type: Date, default: Date.now },
    isMuted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

BugParticipantSchema.index({ bugId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("BugParticipant", BugParticipantSchema);
