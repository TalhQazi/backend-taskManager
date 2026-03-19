const mongoose = require("mongoose");

const ImportJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["running", "completed", "failed", "timeout"],
      default: "running",
    },
    stage: { type: String, default: "queued" },
    startedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    error: { type: String, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false }
);

module.exports = mongoose.model("ImportJob", ImportJobSchema);
