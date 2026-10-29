const mongoose = require("mongoose");

const orgThemeSettingsSchema = new mongoose.Schema(
  {
    orgId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    enforceOrgTheme: {
      type: Boolean,
      default: false,
    },
    forcedThemeKey: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    allowedThemeKeys: {
      type: [String],
      default: [],
    },
    allowUserOverride: {
      type: Boolean,
      default: true,
    },
    disableAnimations: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const OrgThemeSettings = mongoose.model("OrgThemeSettings", orgThemeSettingsSchema);

module.exports = OrgThemeSettings;
