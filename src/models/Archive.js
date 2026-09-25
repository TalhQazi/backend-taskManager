const mongoose = require("mongoose");

const ArchiveSchema = new mongoose.Schema(
  {
    // What type of item was archived (comment, attachment, task, project)
    itemType: { type: String, required: true, index: true },
    // The original item data stored as a flexible object
    itemData: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Legacy / alternative fields for compatibility
    originalId: { type: String, default: "", index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    archivedBy: { type: String, default: "" },
    // Reference to the parent resource
    parentType: { type: String, default: "" }, // 'task', 'project'
    parentId: { type: String, default: "", index: true },
    parentName: { type: String, default: "" },
    // Who archived it
    archivedByUserId: { type: String, default: "" },
    archivedByUsername: { type: String, default: "" },
    archivedByRole: { type: String, default: "" },
    // When it was archived (auto via timestamps)
  },
  { timestamps: true }
);

ArchiveSchema.index({ createdAt: -1 });
ArchiveSchema.index({ itemType: 1, createdAt: -1 });

module.exports = mongoose.model("Archive", ArchiveSchema);
