const mongoose = require("mongoose");

const patentSchema = new mongoose.Schema(
  {
    patentName: {
      type: String,
      required: true,
      trim: true,
    },
    patentType: {
      type: String,
      enum: ["filed", "pending"],
      required: true,
    },
    category: {
      type: String,
      default: "",
    },
    // For filed patents
    filingType: {
      type: String,
      enum: ["Provisional", "Non-Provisional", "International"],
      default: "Provisional",
    },
    filingDate: {
      type: Date,
      default: null,
    },
    applicationNumber: {
      type: String,
      default: "",
    },
    provisionalExpiration: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["Filed", "Issued", "Expired", "Abandoned", "Concept", "Research", "Drafting", "Ready to File"],
      default: "Filed",
    },
    // For pending patents
    stage: {
      type: String,
      enum: ["Concept", "Research", "Drafting", "Ready to File"],
      default: "Concept",
    },
    startDate: {
      type: Date,
      default: null,
    },
    estimatedFilingDate: {
      type: Date,
      default: null,
    },
    inventors: [
      {
        type: String,
      },
    ],
    // Common fields
    notes: {
      type: String,
      default: "",
    },
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
    isExpiringExpiringSoon: {
      type: Boolean,
      default: false,
    },
    daysUntilExpiration: {
      type: Number,
      default: null,
    },
    notifiedDays: {
      type: [Number],
      default: [],
    },
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patent", patentSchema);
