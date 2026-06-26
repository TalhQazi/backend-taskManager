const mongoose = require("mongoose");

const PollAuditLogSchema = new mongoose.Schema(
  {
    pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", required: true, index: true },
    pollTitle: { type: String, required: true },
    action: { type: String, required: true },
    performedBy: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PollAuditLog", PollAuditLogSchema);
