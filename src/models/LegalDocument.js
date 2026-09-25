const mongoose = require("mongoose");

const LegalDocumentSchema = new mongoose.Schema({
  documentNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  fileType: { type: String, required: true, enum: ["PDF", "Word", "Excel", "Image", "Other"], default: "PDF" },
  caseReference: { type: String },
  status: { type: String, enum: ["Draft", "Final", "Filed"], default: "Draft" },
  author: { type: String },
  attachments: [
    {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: Date.now }
    }
  ],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalDocument", LegalDocumentSchema);
