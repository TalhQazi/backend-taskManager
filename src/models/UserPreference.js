const mongoose = require("mongoose");

const userPreferenceSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  showFounderMessages: { type: Boolean, default: true },
  // TaskBlaster UI Preferences
  uiPreferences: {
    theme: {
      type: String,
      enum: ["neon-tech", "metallic-elite", "executive-black", "dark-minimal", "high-contrast", "energy-mode", "crystal-white"],
      default: "dark-minimal"
    },
    customColors: {
      primary: { type: String, default: "#133767" },
      secondary: { type: String, default: "#3b82f6" },
      accent: { type: String, default: "#8b5cf6" },
      textColor: { type: String, default: "#ffffff" }
    },
    panelColors: {
      headerBackground: { type: String, default: "#133767" },
      headerOverlayColor: { type: String, default: "#000000" },
      headerOverlayOpacity: { type: Number, default: 30, min: 0, max: 100 },
      sidebarBackground: { type: String, default: "#0B1323" },
      dashboardBackground: { type: String, default: "#e6f0ff" },
      sidebarIconColor: { type: String, default: "#ffffff" },
      dashboardIconColor: { type: String, default: "#133767" },
      sidebarTextColor: { type: String, default: "#ffffff" },
      dashboardCardBackground: { type: String, default: "#ffffff" },
    },
    glowIntensity: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    },
    animationSpeed: {
      type: String,
      enum: ["slow", "normal", "fast"],
      default: "normal"
    },
    cardStyle: {
      type: String,
      enum: ["glass", "neon", "metallic", "flat"],
      default: "glass"
    },
    layoutDensity: {
      type: String,
      enum: ["compact", "comfortable", "spacious"],
      default: "comfortable"
    },
    layoutConfig: {
      type: Map,
      of: String,
      default: new Map()
    },
    animationSettings: {
      enabled: { type: Boolean, default: true },
      reduceMotion: { type: Boolean, default: false },
      hoverEffects: { type: Boolean, default: true },
      clickEffects: { type: Boolean, default: true }
    }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Pre-save middleware to update updatedAt
userPreferenceSchema.pre("save", function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("UserPreference", userPreferenceSchema);
