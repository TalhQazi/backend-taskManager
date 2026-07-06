const mongoose = require("mongoose");

const NoteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "" },
    content: { type: String, default: "" },
    color: { type: String, default: "#ffffff" },
    isPinned: { type: Boolean, default: false },
    isFavorite: { type: Boolean, default: false },
    folder: { type: String, default: "" },
    tags: [{ type: String }],
    actionItems: [
      {
        text: { type: String, default: "" },
        completed: { type: Boolean, default: false }
      }
    ],
    notesList: [{ type: String }],
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 }
      }
    ],
    lastOpenedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Search index
NoteSchema.index({ userId: 1, title: "text", content: "text" });

module.exports = mongoose.model("Note", NoteSchema);
