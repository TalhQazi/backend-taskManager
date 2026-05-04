const express = require("express");
const router = express.Router();

const ExpenseItem = require("../models/ExpenseItem");
const ExpenseSheet = require("../models/ExpenseSheet");
const { updateSheetTotal } = require("../utils/expenseUtils");
const { requireAuth } = require("../middleware/auth");

// ==============================
// 🔐 PERMISSION HELPERS
// ==============================
function canEditSheet(user, sheet) {
  // ✅ Admin & Manager → full access
  if (user.role === "admin" || user.role === "manager") return true;

  // ✅ Employee + Developer → only own draft
  if (user.role === "employee" || user.role === "developer") {
    return (
      String(sheet.createdBy) === String(user.sub) &&
      sheet.status === "draft"
    );
  }

  // ✅ Optional: Team Lead (if needed)
  if (user.role === "team-lead") {
    return sheet.status !== "approved";
  }

  return false;
}

// ==============================
// ➕ CREATE ITEM
// ==============================
router.post("/", requireAuth, async (req, res) => {
  try {
    const sheet = await ExpenseSheet.findById(req.body.sheetId);

    if (!sheet) {
      return res.status(404).json({ error: "Sheet not found" });
    }

    if (!canEditSheet(req.user, sheet)) {
      return res.status(403).json({ error: "Cannot add items" });
    }

    const item = await ExpenseItem.create(req.body);

    await updateSheetTotal(item.sheetId);

    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ✏️ UPDATE ITEM
// ==============================
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const item = await ExpenseItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const sheet = await ExpenseSheet.findById(item.sheetId);

    if (!canEditSheet(req.user, sheet)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const updated = await ExpenseItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    await updateSheetTotal(item.sheetId);

    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ❌ DELETE ITEM
// ==============================
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const item = await ExpenseItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const sheet = await ExpenseSheet.findById(item.sheetId);

    if (!canEditSheet(req.user, sheet)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    await ExpenseItem.findByIdAndDelete(req.params.id);

    await updateSheetTotal(item.sheetId);

    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📄 GET ITEMS BY SHEET
// ==============================
router.get("/:sheetId", requireAuth, async (req, res) => {
  try {
    const items = await ExpenseItem.find({
      sheetId: req.params.sheetId,
    }).populate("vendorId"); // 🔥 IMPORTANT

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

module.exports = router;