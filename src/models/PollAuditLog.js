const mongoose = require("mongoose");

const PollAuditLogSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    actorId: { type: String, default: "" },
    actorName: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

PollAuditLogSchema.index({ pollId: 1, createdAt: -1 });

module.exports = mongoose.model("PollAuditLog", PollAuditLogSchema);
