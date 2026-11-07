const mongoose = require("mongoose");

const serverMetricSchema = new mongoose.Schema(
  {
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true },
    cpuUsagePercent: { type: Number, required: true },
    memoryUsagePercent: { type: Number, required: true },
    diskUsagePercent: { type: Number, required: true },
    networkInKBps: { type: Number, default: 0 },
    networkOutKBps: { type: Number, default: 0 },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Index for efficient timeseries queries
serverMetricSchema.index({ serverId: 1, recordedAt: -1 });

module.exports = mongoose.model("ServerMetric", serverMetricSchema);
