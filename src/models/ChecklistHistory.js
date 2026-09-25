const mongoose = require("mongoose");

const checklistHistorySchema = new mongoose.Schema(
  {
    websiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Website",
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChecklistItem",
      index: true,
    },
    action: { type: String, required: true }, // e.g., 'item_completed', 'item_blocked', 'override_status', 'evidence_upload'
    previousState: { type: String, default: "" },
    newState: { type: String, default: "" },
    notes: { type: String, default: "" },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    ipAddress: { type: String, default: "" },
    deviceInfo: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChecklistHistory", checklistHistorySchema);
