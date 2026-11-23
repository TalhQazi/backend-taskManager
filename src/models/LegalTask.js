const mongoose = require("mongoose");

const LegalTaskSchema = new mongoose.Schema({
  taskNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  assignedTo: { type: String },
  dueDate: { type: Date },
  caseReference: { type: String },
  status: { type: String, enum: ["To Do", "In Progress", "Done"], default: "To Do" },
  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalTask", LegalTaskSchema);
