const mongoose = require("mongoose");

const AssetLibraryFolderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    parentFolderId: { type: mongoose.Schema.Types.ObjectId, ref: "AssetLibraryFolder", default: null },
    description: { type: String, default: "" },
    isArchived: { type: Boolean, default: false },
    isReadOnly: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

AssetLibraryFolderSchema.index({ parentFolderId: 1, name: 1 });

module.exports = mongoose.model("AssetLibraryFolder", AssetLibraryFolderSchema);
