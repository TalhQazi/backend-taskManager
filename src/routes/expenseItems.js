const express = require("express");
const router = express.Router();

const ExpenseItem = require("../models/ExpenseItem");
const { updateSheetTotal } = require("../utils/expenseUtils");


router.post("/", async (req, res) => {
  try {
    const item = await ExpenseItem.create(req.body);

    await updateSheetTotal(item.sheetId);

    // 🔥 real-time update
    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.put("/:id", async (req, res) => {
  try {
    const item = await ExpenseItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    await updateSheetTotal(item.sheetId);

    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.delete("/:id", async (req, res) => {
  try {
    const item = await ExpenseItem.findByIdAndDelete(req.params.id);

    await updateSheetTotal(item.sheetId);

    global.io.emit("expense:update", { sheetId: item.sheetId });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/:sheetId", async (req, res) => {
  try {
    const items = await ExpenseItem.find({
      sheetId: req.params.sheetId,
    });

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

module.exports = router;