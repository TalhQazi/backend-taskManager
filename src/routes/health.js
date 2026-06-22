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
router.get("/websites", healthController.getWebsitesStatus);
router.get("/incidents", healthController.getIncidents);

// Phase 3: Server Metrics Endpoints
router.get("/servers", healthController.getServers);
router.get("/servers/:id/metrics", healthController.getServerMetrics);


router.post("/alerts/test", healthController.testAlert);

module.exports = router;
