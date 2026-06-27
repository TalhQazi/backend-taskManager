const mongoose = require("mongoose");

const LegalDeadlineSchema = new mongoose.Schema({
  deadlineNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  dueDate: { type: Date },\n  caseReference: { type: String },\n  assignedTo: { type: String },\n  status: { type: String, enum: ["Pending", "Met", "Missed"], default: "Pending" },\n  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalDeadline", LegalDeadlineSchema);
