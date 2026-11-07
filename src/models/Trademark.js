const mongoose = require("mongoose");

const trademarkSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["filed", "granted"],
      required: true,
    },
    registrationNumber: {
      type: String,
      default: "",
    },
    applicationNumber: {
      type: String,
      default: "",
    },
    filingDate: {
      type: Date,
      default: null,
    },
    registrationDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      default: "Filed",
    },
    class: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
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
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trademark", trademarkSchema);
