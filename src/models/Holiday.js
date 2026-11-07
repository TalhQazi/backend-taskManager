const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    country_code: {
      type: String,
      default: "global", // e.g. "US", "IN", "CN", "FR", "DE", "CA", "AU", "global"
      index: true,
    },
    region: {
      type: String,
      default: "Global", // "North America", "Europe", "Middle East", "Asia", "Africa", "South America", "Global"
    },
    religion_category: {
      type: String,
      default: "national", // "national", "religious", "cultural"
    },
    is_lunar_calendar: {
      type: Boolean,
      default: false,
    },
    localization_language_key: {
      type: String,
      required: true,
    },
    significance_level: {
      type: Number,
      default: 1, // 1 (lowest) to 5 (highest)
    },
    static_start_date: {
      type: String, // format "MM-DD" e.g. "07-14"
      default: "",
    },
    static_end_date: {
      type: String, // format "MM-DD" e.g. "07-14"
      default: "",
    },
    themeConfig: {
      backgroundType: {
        type: String,
        enum: ["color", "image"],
        default: "color",
      },
      colorConfig: {
        from: { type: String, default: "#133767" },
        via: { type: String, default: "#133767" },
        to: { type: String, default: "#133767" },
      },
      imageConfig: {
        url: { type: String, default: "" },
        size: { type: String, default: "cover" },
        position: { type: String, default: "center" },
        repeat: { type: String, default: "no-repeat" },
      },
      overlay: {
        enabled: { type: Boolean, default: true },
        color: { type: String, default: "rgba(0,0,0,0.3)" },
      },
      effects: {
        type: String, // "sparkles", "lanterns", "confetti", "snow", "leaves", "stars", ""
        default: "",
      },
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Holiday = mongoose.model("Holiday", holidaySchema);

module.exports = Holiday;
