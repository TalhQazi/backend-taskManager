const mongoose = require("mongoose");

const assetLibraryHeaderSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    images: [{ type: String }], // Array of Data URLs or URLs
    displayMode: { type: String, enum: ["single", "carousel"], default: "single" },
    overlayEnabled: { type: Boolean, default: true },
    overlayColor: { type: String, default: "rgba(0,0,0,0.3)" },
    height: { type: Number, default: 160, min: 80, max: 400 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AssetLibraryHeaderSettings", assetLibraryHeaderSettingsSchema);
