const mongoose = require("mongoose");

const FinishRecordAuditSchema = new mongoose.Schema(
  {
    finishRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinishRecord",
      required: true,
    },
    actorUserId: { type: String, default: "" },
    actorUsername: { type: String, default: "" },
    action: {
      type: String,
      enum: [
        "CREATE",
        "UPDATE",
        "SET_CURRENT",
        "SUPERSEDE",
        "ARCHIVE",
        "RESTORE",
        "PHOTO_ADD",
        "PHOTO_DELETE",
        "ASSIGNMENT_ADD",
      ],
      required: true,
      index: true,
    },
    beforeJson: { type: mongoose.Schema.Types.Mixed, default: null },
    afterJson: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, default: "web" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

FinishRecordAuditSchema.index({ finishRecordId: 1, createdAt: -1 });

module.exports = mongoose.model("FinishRecordAudit", FinishRecordAuditSchema);
