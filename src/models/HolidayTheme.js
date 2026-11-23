const mongoose = require("mongoose");

const holidayThemeSchema = new mongoose.Schema(
  {
    themeKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      enum: ["halloween", "patriotic", "winter", "spring", "cultural", "corporate", "custom"],
      default: "cultural",
    },
    priority: {
      type: Number,
      default: 10,
      index: true,
    },
    palette: {
      primary: { type: String, default: "#3b82f6" },
      secondary: { type: String, default: "#6366f1" },
      accent: { type: String, default: "#ff7a1a" },
      accent2: { type: String, default: "#7b2cff" },
      backgroundBase: { type: String, default: "#0a0714" },
      surfaceTint: { type: String, default: "rgba(123, 44, 255, 0.08)" },
      cardBorder: { type: String, default: "rgba(255, 122, 26, 0.35)" },
      cardGlow: { type: String, default: "0 0 25px rgba(255, 122, 26, 0.25)" },
      textColor: { type: String, default: "#f8fafc" },
      scrimWash: { type: String, default: "rgba(10, 7, 20, 0.65)" },
    },
    layout: {
      headerHeight: { type: Number, default: 64 },
      bannerHeight: { type: Number, default: 120 },
      sideFrameWidth: { type: Number, default: 48 },
      enableSideFrames: { type: Boolean, default: true },
      enableBottomForeground: { type: Boolean, default: true },
      enableHeaderBanner: { type: Boolean, default: true },
    },
    animations: {
      particleType: {
        type: String,
        enum: ["bats", "sparks", "snow", "confetti", "lanterns", "stars", "none"],
        default: "none",
      },
      particleCountDesktop: { type: Number, default: 35 },
      particleCountMobile: { type: Number, default: 18 },
      particleColor: { type: [String], default: ["#ff7a1a", "#7b2cff", "#ffffff"] },
      particleSpeed: { type: Number, default: 1.0 },
      enableGlowPulse: { type: Boolean, default: true },
      transientEffectType: {
        type: String,
        enum: ["ghost-pass", "firework-burst", "none"],
        default: "none",
      },
      transientIntervalSeconds: { type: Number, default: 45 },
    },
    accessibility: {
      minContrastRatio: { type: Number, default: 4.5 },
      reducedMotionAlternative: { type: String, default: "static-decorations" },
      highContrastCompatible: { type: Boolean, default: true },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const HolidayTheme = mongoose.model("HolidayTheme", holidayThemeSchema);

module.exports = HolidayTheme;
