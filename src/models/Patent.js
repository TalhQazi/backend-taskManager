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
    // Expiration watch diagnostics & causes
    expirationReason: {
      type: String,
      enum: ["one-year-clock", "fees", "paperwork", "other", ""],
      default: "",
    },
    expirationReasonDetail: {
      type: String,
      default: "",
    },
    feeStatus: {
      type: String,
      enum: ["pending", "paid", "overdue", "na", ""],
      default: "na",
    },
    feeAmount: {
      type: Number,
      default: 0,
    },
    feeDueDate: {
      type: Date,
      default: null,
    },
    paperworkStatus: {
      type: String,
      enum: ["pending", "complete", "missing", "na", ""],
      default: "na",
    },
    paperworkDetails: {
      type: String,
      default: "",
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
    customReminderDays: {
      type: [Number],
      default: [],
    },
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
