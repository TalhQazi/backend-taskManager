const mongoose = require("mongoose");

const headerSettingsSchema = new mongoose.Schema(
  {
    // Background type: 'color' or 'image'
    backgroundType: {
      type: String,
      enum: ["color", "image"],
      default: "color",
    },
    // Color gradient configuration (default)
    colorConfig: {
      from: { type: String, default: "#133767" },
      via: { type: String, default: "#133767" },
      to: { type: String, default: "#133767" },
    },
    // Image configuration
    imageConfig: {
      url: { type: String, default: "" },
      // Base64 data URL for the image (stored directly in DB)
      dataUrl: { type: String, default: "" },
      // Image repeat: 'no-repeat', 'repeat', 'repeat-x', 'repeat-y'
      repeat: { type: String, default: "no-repeat" },
      // Image size: 'cover', 'contain', 'auto', or custom value
      size: { type: String, default: "cover" },
      // Image position: 'center', 'top', 'bottom', 'left', 'right', etc.
      position: { type: String, default: "center" },
    },
    // Header height in pixels (default 144px = h-36)
    height: {
      type: Number,
      default: 144,
      min: 80,
      max: 300,
    },
    // Overlay color for image (optional, for better text readability)
    overlay: {
      enabled: { type: Boolean, default: true },
      color: { type: String, default: "rgba(0,0,0,0.3)" },
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one document exists
headerSettingsSchema.pre("save", async function (next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    if (count > 0) {
      const error = new Error("Only one header settings document allowed");
      return next(error);
    }
  }
  next();
});

const HeaderSettings = mongoose.model("HeaderSettings", headerSettingsSchema);

module.exports = HeaderSettings;
