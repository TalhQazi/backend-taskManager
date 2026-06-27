const mongoose = require("mongoose");

const LegalTaskSchema = new mongoose.Schema({
  taskNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  assignedTo: { type: String },\n  dueDate: { type: Date },\n  caseReference: { type: String },\n  status: { type: String, enum: ["To Do", "In Progress", "Done"], default: "To Do" },\n  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalTask", LegalTaskSchema);
