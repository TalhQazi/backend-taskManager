const mongoose = require("mongoose");

const NoteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "" },
    content: { type: String, default: "" },
    color: { type: String, default: "#ffffff" },
    isPinned: { type: Boolean, default: false },
    lastOpenedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Search index
NoteSchema.index({ userId: 1, title: "text", content: "text" });

module.exports = mongoose.model("Note", NoteSchema);
