const mongoose = require("mongoose");

const userThemePreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    orgId: {
      type: String,
      index: true,
      trim: true,
      default: "default",
    },
    selectedThemeKey: {
      type: String,
      trim: true,
      lowercase: true,
      default: "auto", // "auto" resolves to date schedule or org default
    },
    immersiveModeEnabled: {
      type: Boolean,
      default: true,
    },
    reduceMotion: {
      type: Boolean,
      default: false,
    },
    lowPerformanceMode: {
      type: Boolean,
      default: false,
    },
    particlesEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const UserThemePreferences = mongoose.model("UserThemePreferences", userThemePreferencesSchema);

module.exports = UserThemePreferences;
