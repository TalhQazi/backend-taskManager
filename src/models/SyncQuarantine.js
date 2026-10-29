const mongoose = require("mongoose");

const SyncQuarantineSchema = new mongoose.Schema(
  {
    clientOperationId: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.Mixed },
    operationType: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed },
    errorCode: { type: String, required: true },
    errorMessage: { type: String, required: true },
    userId: { type: String, index: true },
    clientTimestamp: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SyncQuarantine", SyncQuarantineSchema);
