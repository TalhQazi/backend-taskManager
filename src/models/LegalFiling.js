const mongoose = require("mongoose");

const LegalFilingSchema = new mongoose.Schema({
  filingNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  dateFiled: { type: Date },
  court: { type: String },
  caseReference: { type: String },
  status: { type: String, enum: ["Draft", "Pending", "Accepted", "Rejected"], default: "Draft" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalFiling", LegalFilingSchema);
