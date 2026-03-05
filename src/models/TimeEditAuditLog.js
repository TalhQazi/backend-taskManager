const mongoose = require("mongoose");

const TimeEditAuditLogSchema = new mongoose.Schema(
  {
    timeEntryId: { type: String, required: true },
    field: { type: String, required: true },

    originalValue: { type: mongoose.Schema.Types.Mixed },
    modifiedValue: { type: mongoose.Schema.Types.Mixed },

    editedByUserId: { type: String, required: true },
    ipAddress: { type: String, default: "" },
  },
  { timestamps: true }
);

TimeEditAuditLogSchema.index({ timeEntryId: 1, createdAt: -1 });

module.exports = mongoose.model("TimeEditAuditLog", TimeEditAuditLogSchema);
