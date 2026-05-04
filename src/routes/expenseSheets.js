const express = require("express");
const router = express.Router();

const ExpenseSheet = require("../models/ExpenseSheet");
const { requireAuth } = require("../middleware/auth");

// ==============================
// 🔐 PERMISSION HELPERS
// ==============================
function canApprove(user) {
  return ["manager", "admin"].includes(user.role);
}

// ==============================
// ➕ CREATE SHEET
// ==============================
router.post("/", requireAuth, async (req, res) => {
  try {
    const sheet = await ExpenseSheet.create({
      ...req.body,
      createdBy: req.user.sub, // ✅ MUST
      status: "draft",
    });

    res.json(sheet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📄 GET SHEETS BY PROJECT
// ==============================
router.get("/:projectId", requireAuth, async (req, res) => {
  try {
    const sheets = await ExpenseSheet.find({
      projectId: req.params.projectId,
    });

    res.json(sheets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// 📤 SUBMIT
// ==============================
router.post("/:id/submit", requireAuth, async (req, res) => {
  const sheet = await ExpenseSheet.findById(req.params.id);

  if (!sheet) return res.status(404).json({ error: "Not found" });

  if (String(sheet.createdBy) !== String(req.user.sub)) {
    return res.status(403).json({ error: "Not allowed" });
  }

  if (sheet.status !== "draft") {
    return res.status(400).json({ error: "Already submitted" });
  }

  sheet.status = "submitted";
  await sheet.save();

  global.io.emit("expense:update", { sheetId: sheet._id });

  res.json({ success: true });
});

// ✅ APPROVE
router.post("/:id/approve", async (req, res) => {
  try {
    const sheet = await ExpenseSheet.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

    res.json({ success: true, data: sheet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Approve failed" }); 
  }
});

// ❌ REJECT
router.post("/:id/reject", async (req, res) => {
  try {
    const sheet = await ExpenseSheet.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    res.json({ success: true, data: sheet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Reject failed" });
  }
});

module.exports = router;