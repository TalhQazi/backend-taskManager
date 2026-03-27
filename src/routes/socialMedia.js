const express = require("express");
const SocialMediaAccount = require("../models/SocialMediaAccount");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get all social media accounts
router.get("/", async (req, res, next) => {
  try {
    const accounts = await SocialMediaAccount.find()
      .populate("credentialId")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: accounts });
  } catch (err) {
    next(err);
  }
});

// Get single account by ID
router.get("/:id", async (req, res, next) => {
  try {
    const account = await SocialMediaAccount.findById(req.params.id)
      .populate("credentialId")
      .lean();
    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }
    res.json({ item: account });
  } catch (err) {
    next(err);
  }
});

// Create new social media account (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { platform, accountHandle, ...rest } = req.body;

    if (!platform || !accountHandle) {
      return res.status(400).json({
        error: { message: "platform and accountHandle are required" },
      });
    }

    const newAccount = new SocialMediaAccount({
      platform,
      accountHandle,
      ...rest,
      createdBy: req.user?.username || "System",
    });

    await newAccount.save();
    await newAccount.populate("credentialId");
    res.status(201).json({ item: newAccount });
  } catch (err) {
    next(err);
  }
});

// Update social media account (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const account = await SocialMediaAccount.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("credentialId");

    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }

    res.json({ item: account });
  } catch (err) {
    next(err);
  }
});

// Delete social media account (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const account = await SocialMediaAccount.findByIdAndDelete(req.params.id);
    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
