const mongoose = require("mongoose");

const LegalDocumentSchema = new mongoose.Schema({
  documentNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  fileType: { type: String, required: true, enum: ["PDF", "Word", "Excel", "Image", "Other"], default: "PDF" },
  caseReference: { type: String },
  status: { type: String, enum: ["Draft", "Final", "Filed"], default: "Draft" },
  author: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalDocument", LegalDocumentSchema);
