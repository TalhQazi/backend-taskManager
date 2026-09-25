const mongoose = require("mongoose");

const themeAssetSchema = new mongoose.Schema(
  {
    themeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HolidayTheme",
      required: true,
      index: true,
    },
    themeKey: {
      type: String,
      required: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    deviceVariant: {
      type: String,
      enum: ["desktop", "tablet", "mobile"],
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: [
        "background",
        "headerBanner",
        "sideFrameLeft",
        "sideFrameRight",
        "bottomForeground",
        "transientOverlay",
        "particleSprite",
      ],
      required: true,
      index: true,
    },
    cdnUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fallbackUrl: {
      type: String,
      default: "",
    },
    dimensions: {
      width: { type: Number, default: 1920 },
      height: { type: Number, default: 1080 },
    },
    fileSize: {
      type: Number,
      default: 0, // in bytes
    },
    format: {
      type: String,
      enum: ["webp", "avif", "png", "svg", "jpeg"],
      default: "webp",
    },
    loadPriority: {
      type: String,
      enum: ["critical", "high", "normal", "low"],
      default: "normal",
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast asset resolution by theme, variant, and type
themeAssetSchema.index({ themeKey: 1, deviceVariant: 1, assetType: 1 });

const ThemeAsset = mongoose.model("ThemeAsset", themeAssetSchema);

module.exports = ThemeAsset;
