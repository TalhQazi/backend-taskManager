const mongoose = require("mongoose");

const LegalNoteSchema = new mongoose.Schema({
  noteNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  content: { type: String },\n  caseReference: { type: String },\n  author: { type: String },\n  dateAdded: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalNote", LegalNoteSchema);
