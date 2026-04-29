const express = require("express");
const Trademark = require("../models/Trademark");
const { requireAuth, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");

const router = express.Router();

// Get all filed trademarks
router.get("/filed", async (req, res, next) => {
  try {
    const items = await Trademark.find({ type: "filed" })
      .sort({ name: 1 })
      .lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Get all granted trademarks
router.get("/granted", async (req, res, next) => {
  try {
    const items = await Trademark.find({ type: "granted" })
      .sort({ name: 1 })
      .lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Get single trademark by ID
router.get("/:id", async (req, res, next) => {
  try {
    const item = await Trademark.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "Trademark not found" } });
    }
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// Create new trademark
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { name, type } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: { message: "name and type are required" } });
    }
    const newItem = new Trademark({ ...req.body, createdBy: req.user?.username || "System" });
    await newItem.save();
    res.status(201).json({ item: newItem });
  } catch (err) { next(err); }
});

// Update trademark
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await Trademark.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: { message: "Trademark not found" } });
    res.json({ item });
  } catch (err) { next(err); }
});

// Delete trademark
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await Trademark.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: { message: "Trademark not found" } });
    res.json({ message: "Trademark deleted successfully" });
  } catch (err) { next(err); }
});

module.exports = router;
