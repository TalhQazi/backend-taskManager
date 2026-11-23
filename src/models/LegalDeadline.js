const mongoose = require("mongoose");

const LegalDeadlineSchema = new mongoose.Schema({
  deadlineNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  dueDate: { type: Date },
  caseReference: { type: String },
  assignedTo: { type: String },
  status: { type: String, enum: ["Pending", "Met", "Missed"], default: "Pending" },
  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalDeadline", LegalDeadlineSchema);
