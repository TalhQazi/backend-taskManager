const mongoose = require("mongoose");

const LegalNoteSchema = new mongoose.Schema({
  noteNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  content: { type: String },
  caseReference: { type: String },
  author: { type: String },
  dateAdded: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalNote", LegalNoteSchema);
