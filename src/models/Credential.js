const mongoose = require("mongoose");

const credentialSchema = new mongoose.Schema(
  {
    resourceName: {
      type: String,
      required: true,
      trim: true,
    },
    resourceType: {
      type: String,
      enum: ["website", "social-media", "api", "service", "other"],
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      default: "",
    },
    // Passwords and API keys are encrypted in the database
    passwordHash: {
      type: String,
      default: "",
    },
    apiKey: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Audit fields
    lastUsedAt: {
      type: Date,
      default: null,
    },
    accessLog: [
      {
        accessedAt: {
          type: Date,
          default: Date.now,
        },
        accessedBy: String,
        action: String,
      },
    ],
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Credential", credentialSchema);
