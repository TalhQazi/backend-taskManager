const mongoose = require("mongoose");

const websiteSchema = new mongoose.Schema(
  {
    siteName: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    websiteType: {
      type: String,
      enum: ["active", "future"],
      required: true,
    },
    // For active websites
    platform: {
      type: String,
      default: "",
    },
    hostingProvider: {
      type: String,
      default: "",
    },
    loginEmail: {
      type: String,
      default: "",
    },
    loginPassword: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Live", "Maintenance", "Development", "Offline"],
      default: "Development",
    },
    owner: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    // For future websites
    projectName: {
      type: String,
      default: "",
    },
    domain: {
      type: String,
      default: "",
    },
    developmentStage: {
      type: String,
      enum: ["Concept", "Planning", "Design", "Development", "Testing", "Ready for Launch"],
      default: "Concept",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    concept: {
      type: String,
      default: "",
    },
    // Common fields
    fileAttachments: [
      {
        fileName: String,
        fileUrl: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Website", websiteSchema);
