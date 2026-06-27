const mongoose = require("mongoose");

const LegalDocumentSchema = new mongoose.Schema({
  documentNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  fileType: { type: String, required: true, enum: ["PDF", "Word", "Excel", "Image", "Other"], default: "PDF" },\n  caseReference: { type: String },\n  status: { type: String, enum: ["Draft", "Final", "Filed"], default: "Draft" },\n  author: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalDocument", LegalDocumentSchema);
