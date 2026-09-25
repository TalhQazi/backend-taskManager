const express = require("express");
const TaskDependency = require("../models/TaskDependency");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// List dependencies, optionally scoped to a set of task ids (?taskIds=a,b,c)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const ids = String(req.query.taskIds || "").split(",").map((s) => s.trim()).filter(Boolean);
    const filter = ids.length
      ? { $or: [{ predecessorId: { $in: ids } }, { successorId: { $in: ids } }] }
      : {};
    const items = await TaskDependency.find(filter).limit(5000).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { predecessorId, successorId, type = "FS", lagDays = 0 } = req.body || {};
    if (!predecessorId || !successorId) {
      return res.status(400).json({ error: { message: "predecessorId and successorId are required" } });
    }
    if (String(predecessorId) === String(successorId)) {
      return res.status(400).json({ error: { message: "A task cannot depend on itself" } });
    }
    const item = await TaskDependency.findOneAndUpdate(
      { predecessorId, successorId, type },
      { predecessorId, successorId, type, lagDays, createdBy: req.user?.sub || null },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    await TaskDependency.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
