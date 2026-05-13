const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

const Property = require("../models/Property");
const Unit = require("../models/Unit");
const AtlasAccount = require("../models/AtlasAccount");
const JournalEntry = require("../models/JournalEntry");

// --- PROPERTIES ---
router.get("/properties", requireAuth, async (req, res) => {
  try {
    const items = await Property.find().populate("company");
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/properties", requireAuth, async (req, res) => {
  try {
    const item = new Property(req.body);
    await item.save();
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- UNITS ---
router.get("/units", requireAuth, async (req, res) => {
  try {
    const items = await Unit.find().populate("property");
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/units", requireAuth, async (req, res) => {
  try {
    const item = new Unit(req.body);
    await item.save();
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- CHART OF ACCOUNTS ---
router.get("/accounts", requireAuth, async (req, res) => {
  try {
    const items = await AtlasAccount.find().populate("company");
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/accounts", requireAuth, async (req, res) => {
  try {
    const item = new AtlasAccount(req.body);
    await item.save();
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- GENERAL LEDGER / JOURNAL ENTRIES ---
router.get("/journal", requireAuth, async (req, res) => {
  try {
    const items = await JournalEntry.find().populate("lines.account");
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/journal", requireAuth, async (req, res) => {
  try {
    const item = new JournalEntry({ ...req.body, createdBy: req.user._id });
    await item.save();
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
