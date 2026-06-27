const mongoose = require("mongoose");

const LegalFilingSchema = new mongoose.Schema({
  filingNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  dateFiled: { type: Date },\n  court: { type: String },\n  caseReference: { type: String },\n  status: { type: String, enum: ["Draft", "Pending", "Accepted", "Rejected"], default: "Draft" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalFiling", LegalFilingSchema);
