const mongoose = require("mongoose");

const AsanaJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    status: { 
      type: String, 
      enum: ["running", "completed", "failed", "timeout"], 
      default: "running",
      index: true 
    },
    stage: { type: String, default: "queued" },
    startedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    error: { type: String },
    result: { type: mongoose.Schema.Types.Mixed },
    token: { type: String, required: true },
    workspaceId: { type: String, required: true },
    progress: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Index for cleanup of old jobs (auto-delete after 24 hours)
AsanaJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("AsanaJob", AsanaJobSchema);