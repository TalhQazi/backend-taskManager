const express = require("express");
const ExpenseSheet = require("../models/ExpenseSheet");
const ExpenseItem = require("../models/ExpenseItem");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get expense sheets by Project ID
router.get("/:projectId", requireAuth, async (req, res, next) => {
  try {
    const sheets = await ExpenseSheet.find({ projectId: req.params.projectId }).lean();
    res.json(sheets);
  } catch (err) {
    next(err);
  }
});

// Get expense items for a sheet
router.get("/items/:sheetId", requireAuth, async (req, res, next) => {
  try {
    const items = await ExpenseItem.find({ expenseSheetId: req.params.sheetId }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// Create new expense sheet for Project
router.post("/:projectId", requireAuth, async (req, res, next) => {
  try {
    const { title, description } = req.body;
    let sheet = await ExpenseSheet.findOne({ projectId: req.params.projectId });
    
    if (!sheet) {
      sheet = new ExpenseSheet({
        projectId: req.params.projectId,
        title: title || "Project Expense Sheet",
        description: description || "",
        createdBy: req.user?.username || "System"
      });
      await sheet.save();
    }
    
    res.status(201).json({ item: sheet });
  } catch (err) {
    next(err);
  }
});

// Add item to expense sheet
router.post("/:projectId/items", requireAuth, async (req, res, next) => {
  try {
    const { phase, itemName, partNumber, vendorName, estimatedTotalCents, purchaseStatus } = req.body;
    
    let sheet = await ExpenseSheet.findOne({ projectId: req.params.projectId });
    if (!sheet) {
      sheet = new ExpenseSheet({
        projectId: req.params.projectId,
        title: "Project Expense Sheet",
        createdBy: req.user?.username || "System"
      });
      await sheet.save();
    }

    const newItem = new ExpenseItem({
      expenseSheetId: sheet._id,
      projectId: req.params.projectId,
      phase,
      itemName,
      partNumber,
      vendorName,
      estimatedTotalCents,
      purchaseStatus
    });

    await newItem.save();
    res.status(201).json({ item: newItem });
  } catch (err) {
    next(err);
  }
});

// Update expense item
router.put("/:projectId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const { phase, itemName, partNumber, vendorName, estimatedTotalCents, purchaseStatus, paidCents, quotes } = req.body;
    
    const updateData = {};
    if (phase !== undefined) updateData.phase = phase;
    if (itemName !== undefined) updateData.itemName = itemName;
    if (partNumber !== undefined) updateData.partNumber = partNumber;
    if (vendorName !== undefined) updateData.vendorName = vendorName;
    if (estimatedTotalCents !== undefined) updateData.estimatedTotalCents = estimatedTotalCents;
    if (purchaseStatus !== undefined) updateData.purchaseStatus = purchaseStatus;
    if (paidCents !== undefined) updateData.paidCents = paidCents;
    if (quotes !== undefined) updateData.quotes = quotes;

    const item = await ExpenseItem.findOneAndUpdate(
      { _id: req.params.itemId, projectId: req.params.projectId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!item) return res.status(404).json({ error: { message: "Item not found" } });

    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// Delete expense item
router.delete("/:projectId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const item = await ExpenseItem.findOneAndDelete({ _id: req.params.itemId, projectId: req.params.projectId });
    if (!item) return res.status(404).json({ error: { message: "Item not found" } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Status actions
router.post("/:id/submit", requireAuth, async (req, res, next) => {
  try {
    const sheet = await ExpenseSheet.findByIdAndUpdate(req.params.id, { status: "submitted" }, { new: true });
    res.json({ item: sheet });
  } catch (err) { next(err); }
});

router.post("/:id/approve", requireAuth, async (req, res, next) => {
  try {
    const sheet = await ExpenseSheet.findByIdAndUpdate(req.params.id, { status: "approved" }, { new: true });
    res.json({ item: sheet });
  } catch (err) { next(err); }
});

router.post("/:id/reject", requireAuth, async (req, res, next) => {
  try {
    const sheet = await ExpenseSheet.findByIdAndUpdate(req.params.id, { status: "rejected" }, { new: true });
    res.json({ item: sheet });
  } catch (err) { next(err); }
});

module.exports = router;
