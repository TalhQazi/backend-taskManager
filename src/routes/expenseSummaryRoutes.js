const express = require("express");
const router = express.Router();

const { getProjectCost } = require("../utils/projectCost");
const { requireAuth } = require("../middleware/auth");

// 📊 PROJECT SUMMARY
router.get("/project/:projectId/summary", requireAuth, async (req, res) => {
  try {
    const data = await getProjectCost(req.params.projectId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;