const mongoose = require("mongoose");

const LegalReportSchema = new mongoose.Schema({
  reportNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  reportType: { type: String, enum: ["Financial", "Case Status", "Time Tracking", "Other"], default: "Case Status" },
  generatedBy: { type: String },
  dateGenerated: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalReport", LegalReportSchema);
