const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, default: "" },
    url: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const AssetLibraryAssetSchema = new mongoose.Schema(
  {
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: "AssetLibraryFolder", default: null },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    tags: { type: [String], default: [] },

    originalFilename: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    extension: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },

    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    s3KeyOriginal: { type: String, default: "" },
    urlOriginal: { type: String, default: "" },

    status: { type: String, enum: ["active", "archived"], default: "active" },
    uploadedBy: { type: String, default: "" },

    attachment: { type: AttachmentSchema, default: () => ({}) },
  },
  { timestamps: true }
);

AssetLibraryAssetSchema.index({ folderId: 1, createdAt: -1 });
AssetLibraryAssetSchema.index({ title: 1 });
AssetLibraryAssetSchema.index({ originalFilename: 1 });

module.exports = mongoose.model("AssetLibraryAsset", AssetLibraryAssetSchema);
