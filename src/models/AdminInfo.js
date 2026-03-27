const mongoose = require("mongoose");

const adminInfoSchema = new mongoose.Schema(
  {
    // Optional title
    title: {
      type: String,
      default: "",
      maxlength: 200,
    },
    // Text content (optional - can be text only)
    text: {
      type: String,
      default: "",
      maxlength: 5000,
    },
    // Media items: images and/or files (optional - can be media only)
    media: [
      {
        type: {
          type: String,
          enum: ["image", "file"],
          required: true,
        },
        // Original file name
        fileName: {
          type: String,
          required: true,
        },
        // Base64 data URL for the media
        dataUrl: {
          type: String,
          required: true,
        },
        // MIME type (e.g., 'image/jpeg', 'application/pdf')
        mimeType: {
          type: String,
          required: true,
        },
        // File size in bytes
        size: {
          type: Number,
          required: true,
        },
        // Upload timestamp
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Created and updated by admin user
    createdBy: {
      type: String,
      default: "System",
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
adminInfoSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AdminInfo", adminInfoSchema);
