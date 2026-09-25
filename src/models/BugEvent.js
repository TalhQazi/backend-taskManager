const mongoose = require("mongoose");

const BugEventSchema = new mongoose.Schema(
  {
    bugId: { type: mongoose.Schema.Types.ObjectId, ref: "BugReport", required: true, index: true },
    actorId: { type: String, default: "" },
    actorName: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    eventType: {
      type: String,
      required: true,
      enum: [
        "BUG_CREATED",
        "ASSIGNED",
        "REASSIGNED",
        "PRIORITY_CHANGED",
        "SEVERITY_CHANGED",
        "STATUS_CHANGED",
        "COMMENT_ADDED",
        "COMMENT_EDITED",
        "COMMENT_DELETED",
        "ATTACHMENT_UPLOADED",
        "ATTACHMENT_REMOVED",
        "RESOLUTION_SUBMITTED",
        "REPORTER_CONFIRMED",
        "REPORTER_REJECTED",
        "BUG_REOPENED",
        "ADMIN_OVERRIDE",
        "INFO_REQUESTED",
      ],
    },
    details: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugEvent", BugEventSchema);
