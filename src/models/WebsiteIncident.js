const mongoose = require("mongoose");

const websiteIncidentSchema = new mongoose.Schema(
  {
    websiteId: { type: mongoose.Schema.Types.ObjectId, ref: "Website", required: false },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: false },
    type: { type: String, enum: ["DOWN", "DEGRADED", "SSL_ISSUE", "HIGH_CPU", "HIGH_MEMORY", "HIGH_DISK"], required: true },
    status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
    startedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    errorDetails: { type: String },
    rootCause: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WebsiteIncident", websiteIncidentSchema);
