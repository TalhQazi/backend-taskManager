const express = require("express");
const TaskSavedView = require("../models/TaskSavedView");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Own saved views + org-shared ones.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.sub || req.user?.id;
    const items = await TaskSavedView.find({ $or: [{ userId }, { isShared: true }] })
      .sort({ isDefault: -1, name: 1 })
      .lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.sub || req.user?.id;
    const { name, viewType = "card", filters = {}, sort = "", columns = [], isShared = false, isDefault = false } = req.body || {};
    if (!name) return res.status(400).json({ error: { message: "name is required" } });
    const item = await TaskSavedView.findOneAndUpdate(
      { userId, name },
      { userId, name, viewType, filters, sort, columns, isShared, isDefault },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.sub || req.user?.id;
    await TaskSavedView.findOneAndDelete({ _id: req.params.id, userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
