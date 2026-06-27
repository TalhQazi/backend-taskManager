const mongoose = require("mongoose");

const LegalEvidenceSchema = new mongoose.Schema({
  evidenceNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  evidenceType: { type: String, required: true, enum: ["Physical", "Digital", "Testimonial"], default: "Physical" },\n  dateAcquired: { type: Date },\n  location: { type: String },\n  caseReference: { type: String },\n  status: { type: String, enum: ["Logged", "Under Review", "Admitted"], default: "Logged" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalEvidence", LegalEvidenceSchema);
