const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "" },
    assignees: { type: [String], default: [], index: true },
    logo: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
ProjectSchema.index({ createdAt: -1 });
ProjectSchema.index({ assignees: 1, createdAt: -1 });

module.exports = mongoose.model("Project", ProjectSchema);
