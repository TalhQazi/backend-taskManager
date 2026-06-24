const Server = require("../models/Server");
const ServerMetric = require("../models/ServerMetric");
const Website = require("../models/Website");
const WebsiteCheck = require("../models/WebsiteCheck");
const WebsiteIncident = require("../models/WebsiteIncident");
const { dispatchAlert } = require("../utils/alertManager");

exports.getOverview = async (req, res) => {
  try {
    const servers = await Server.find({ isMonitoringEnabled: true });
    const websites = await Website.find({ websiteType: "active", isMonitoringEnabled: { $ne: false }, url: { $exists: true, $ne: "" } });
    
    const liveServers = servers.filter(s => s.status === "LIVE").length;
    const downServers = servers.filter(s => s.status === "DOWN" || s.status === "DEGRADED").length;

    const liveWebsites = websites.filter(w => w.healthStatus === "LIVE").length;
    const downWebsites = websites.filter(w => w.healthStatus === "DOWN" || w.healthStatus === "DEGRADED").length;

    const openIncidents = await WebsiteIncident.countDocuments({ status: "OPEN" });

    res.json({
      servers: { total: servers.length, live: liveServers, down: downServers },
      websites: { total: websites.length, live: liveWebsites, down: downWebsites },
      openIncidents
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to fetch health overview" } });
  }
};

exports.getWebsitesStatus = async (req, res) => {
  try {
    const websites = await Website.find({ websiteType: "active", isMonitoringEnabled: { $ne: false }, url: { $exists: true, $ne: "" } })
      .select("siteName url healthStatus lastCheckedAt sslStatus sslExpiryDate responseTimeMs uptimePercentage")
      .sort({ healthStatus: 1, siteName: 1 });
      
    res.json({ websites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to fetch websites status" } });
  }
};

exports.getIncidents = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const incidents = await WebsiteIncident.find()
      .populate("websiteId", "siteName url")
      .sort({ startedAt: -1 })
      .limit(limit);
      
    res.json({ incidents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to fetch incidents" } });
  }
};

exports.getServers = async (req, res) => {
  try {
    const servers = await Server.find().sort({ name: 1 });
    res.json({ servers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to fetch servers" } });
  }
};

exports.getServerMetrics = async (req, res) => {
  try {
    const { id } = req.params;
    const hours = parseInt(req.query.hours) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const metrics = await ServerMetric.find({ serverId: id, recordedAt: { $gte: since } })
      .sort({ recordedAt: 1 });
    
    res.json({ metrics });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to fetch server metrics" } });
  }
};

exports.ingestMetrics = async (req, res) => {
  try {
    const { serverId, cpu, memory, disk, networkIn, networkOut } = req.body;
    
    if (!serverId) {
      return res.status(400).json({ error: { message: "serverId is required" } });
    }

    // 1. Find or create the Server
    let server = await Server.findOne({ name: serverId });
    if (!server) {
      server = new Server({
        name: serverId,
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown'
      });
    }

    // 2. Update Server status and last seen
    server.lastSeenAt = new Date();
    if (cpu > 90 || memory > 90 || disk > 90) {
      server.status = 'DEGRADED';
    } else {
      server.status = 'LIVE';
    }
    await server.save();

    // 3. Create the Metric using the Server's ObjectId
    const metric = await ServerMetric.create({
      serverId: server._id,
      cpuUsagePercent: cpu,
      memoryUsagePercent: memory,
      diskUsagePercent: disk,
      networkInKBps: networkIn || 0,
      networkOutKBps: networkOut || 0
    });

    res.json({ success: true, metric });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to ingest metrics" } });
  }
};

exports.testAlert = async (req, res) => {
  try {
    await dispatchAlert(
      "[TEST] System Health Center Alert",
      "This is a test alert from the System Health Center to verify email delivery.",
      "DOWN" // using DOWN to trigger alert
    );
    res.json({ success: true, message: "Test alert dispatched." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: "Failed to dispatch test alert" } });
  }
};
