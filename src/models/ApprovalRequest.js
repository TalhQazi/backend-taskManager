const mongoose = require("mongoose");

const ApprovalRequestSchema = new mongoose.Schema(
  {
    module: { type: String, required: true }, // e.g. "Expense", "Bill", "JournalEntry"
    referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    approvers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
    comments: [{ user: String, text: String, date: { type: Date, default: Date.now } }],
    priority: { type: String, enum: ["Low", "Medium", "High", "Urgent"], default: "Medium" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ApprovalRequest", ApprovalRequestSchema);
