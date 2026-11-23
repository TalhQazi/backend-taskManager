const express = require("express");
const AppStoreLink = require("../models/AppStoreLink");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const items = await AppStoreLink.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const item = await AppStoreLink.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "App store link not found" } });
    }
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { appName, googlePlayUrl, appleStoreUrl, brand, status, notes } = req.body;

    if (!appName || !String(appName).trim()) {
      return res.status(400).json({ error: { message: "App name is required" } });
    }

    if (!googlePlayUrl && !appleStoreUrl) {
      return res.status(400).json({
        error: { message: "At least one store link (Google Play or Apple Store) is required" },
      });
    }

    const item = new AppStoreLink({
      appName: String(appName).trim(),
      brand: brand || "",
      googlePlayUrl: googlePlayUrl || "",
      appleStoreUrl: appleStoreUrl || "",
      status: status || "Active",
      notes: notes || "",
      createdBy: req.user?.username || "System",
    });

    await item.save();
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    delete patch._id;
    delete patch.createdAt;
    delete patch.updatedAt;
    delete patch.__v;

    if (patch.appName !== undefined && !String(patch.appName).trim()) {
      return res.status(400).json({ error: { message: "App name is required" } });
    }

    const item = await AppStoreLink.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });

    if (!item) {
      return res.status(404).json({ error: { message: "App store link not found" } });
    }

    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await AppStoreLink.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ error: { message: "App store link not found" } });
    }
    res.json({ message: "App store link deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
