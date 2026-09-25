const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "" },
    assignees: { type: [String], default: [], index: true },
    teamLead: { type: String, default: "", index: true },
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
    dropboxAttachments: [
      {
        file_name: { type: String, required: true },
        file_type: { type: String, default: "" },
        file_size: { type: Number, default: 0 },
        dropbox_file_id: { type: String, required: true },
        dropbox_path: { type: String, required: true },
        temporary_link: { type: String, default: "" },
        created_at: { type: Date, default: Date.now },
      },
    ],
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
    introVideoUrl: { type: String, default: "" },
    status: { type: String, default: "Pending", index: true },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
ProjectSchema.index({ createdAt: -1 });
ProjectSchema.index({ assignees: 1, createdAt: -1 });
// Text index for search queries (replaces regex scans)
ProjectSchema.index({ name: "text", description: "text" });

module.exports = mongoose.model("Project", ProjectSchema);
