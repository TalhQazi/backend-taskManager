const mongoose = require("mongoose");

const BugReportSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: false },
    taskTitle: { type: String, default: "" },
    title: { type: String, required: true },
    description: { type: String, required: true },
    source: {
      panel: { type: String, default: "" },
      path: { type: String, default: "" },
    },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
      },
    ],
    status: { type: String, enum: ["open", "closed"], default: "open" },
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugReport", BugReportSchema);
