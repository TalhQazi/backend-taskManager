const express = require("express");
const router = express.Router();
const healthController = require("../controllers/healthController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Ingestion endpoint (to be called by agent script from remote servers)
// Simple API Key auth
const requireAgentAuth = (req, res, next) => {
  const token = req.headers["x-agent-token"];
  const validToken = process.env.SERVER_AGENT_API_KEY || "default_agent_token_please_change";
  if (!token || token !== validToken) {
    return res.status(401).json({ error: { message: "Unauthorized agent" } });
  }
  next();
};

router.post("/metrics/ingest", requireAgentAuth, healthController.ingestMetrics);

// Secure all other health routes to admin and super-admin only
router.use(requireAuth, requireRole(["admin", "super-admin"]));

router.get("/overview", healthController.getOverview);
router.get("/system", healthController.getSystemStats);
router.get("/websites", healthController.getWebsitesStatus);
router.get("/incidents", healthController.getIncidents);

// Phase 3: Server Metrics Endpoints
router.get("/servers", healthController.getServers);
router.get("/servers/:id/metrics", healthController.getServerMetrics);
router.get("/servers/:id/storage-health", healthController.getStorageHealth);


router.post("/alerts/test", healthController.testAlert);

/**
 * Performance snapshot: slowest routes, MongoDB command timings, cache hit
 * ratio and process memory. Admin-gated by the router.use above.
 */
router.get("/performance", (req, res) => {
  const { getTimingStats, SLOW_REQUEST_MS } = require("../middleware/requestTiming");
  const { getQueryStats } = require("../lib/db");
  const { getCacheStats } = require("../lib/cache");

  const mem = process.memoryUsage();
  res.json({
    uptimeSeconds: Math.round(process.uptime()),
    slowRequestThresholdMs: SLOW_REQUEST_MS,
    routes: getTimingStats(Number(req.query.limit) || 25),
    mongo: getQueryStats(),
    cache: getCacheStats(),
    memory: {
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
    },
  });
});

module.exports = router;
