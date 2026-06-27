const mongoose = require("mongoose");

const LegalEvidenceSchema = new mongoose.Schema({
  evidenceNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  evidenceType: { type: String, required: true, enum: ["Physical", "Digital", "Testimonial"], default: "Physical" },
  dateAcquired: { type: Date },
  location: { type: String },
  caseReference: { type: String },
  status: { type: String, enum: ["Logged", "Under Review", "Admitted"], default: "Logged" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalEvidence", LegalEvidenceSchema);
