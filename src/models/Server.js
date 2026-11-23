const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ipAddress: { type: String, required: true },
    type: { type: String, enum: ["Web", "Database", "Cache", "Worker", "Other"], default: "Web" },
    status: { type: String, enum: ["LIVE", "DEGRADED", "DOWN", "UNKNOWN"], default: "UNKNOWN" },
    lastSeenAt: { type: Date },
    uptimeSeconds: { type: Number, default: 0 },
    cpuCores: { type: Number, default: 0 },
    totalMemoryMB: { type: Number, default: 0 },
    totalDiskMB: { type: Number, default: 0 },
    os: { type: String, default: "" },
    isMonitoringEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Server", serverSchema);
