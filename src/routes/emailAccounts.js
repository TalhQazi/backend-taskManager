const express = require("express");
const EmailAccount = require("../models/EmailAccount");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get all email accounts
router.get("/", async (req, res, next) => {
  try {
    const accounts = await EmailAccount.find()
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
    const account = await EmailAccount.findById(req.params.id).lean();
    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }
    res.json({ item: account });
  } catch (err) {
    next(err);
  }
});

// Create new email account (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { email, password, provider, brand, status, notes } = req.body;

    if (!email) {
      return res.status(400).json({
        error: { message: "email is required" },
      });
    }

    const newAccount = new EmailAccount({
      email,
      password,
      provider: provider || "Other",
      brand: brand || "",
      status: status || "Active",
      notes: notes || "",
      createdBy: req.user?.username || "System",
    });

    await newAccount.save();
    res.status(201).json({ item: newAccount });
  } catch (err) {
    next(err);
  }
});

// Update email account (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const account = await EmailAccount.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }

    res.json({ item: account });
  } catch (err) {
    next(err);
  }
});

// Delete email account (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const account = await EmailAccount.findByIdAndDelete(req.params.id);
    if (!account) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
