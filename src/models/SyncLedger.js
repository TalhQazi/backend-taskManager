const mongoose = require("mongoose");

const SyncLedgerSchema = new mongoose.Schema(
  {
    serverLsn: { type: Number, required: true, index: true, unique: true },
    entityType: {
      type: String,
      required: true,
      enum: ["task", "project", "subtask", "comment", "attachment", "user_preference"],
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    operationType: {
      type: String,
      required: true,
      enum: ["INSERT", "UPDATE", "DELETE"],
    },
    version: { type: Number, required: true, default: 1 },
    isDeleted: { type: Boolean, default: false, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    clientOperationId: { type: String, required: true, index: true },
    clientTimestamp: { type: Date },
    updatedBy: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

// Compound indexes for fast cursor delta querying and entity history
SyncLedgerSchema.index({ serverLsn: 1, entityType: 1 });
SyncLedgerSchema.index({ entityType: 1, entityId: 1, version: -1 });

module.exports = mongoose.model("SyncLedger", SyncLedgerSchema);
