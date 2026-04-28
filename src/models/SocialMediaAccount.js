const mongoose = require("mongoose");

const socialMediaAccountSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      enum: [
        "Instagram", 
        "Facebook", 
        "YouTube", 
        "TikTok", 
        "LinkedIn", 
        "X/Twitter",
        "Liberty social",
        "Rumble",
        "Truth Social",
        "Threads",
        "Other"
      ],
    },
    accountHandle: {
      type: String,
      required: true,
      trim: true,
    },
    accountEmail: {
      type: String,
      default: "",
    },
    username: {
      type: String,
      default: "",
    },
    brand: {
      type: String,
      default: "",
    },
    url: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Suspended"],
      default: "Active",
    },
    followers: {
      type: Number,
      default: 0,
    },
    engagementRate: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      default: "",
    },
    // Credential reference
    credentialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Credential",
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SocialMediaAccount", socialMediaAccountSchema);
