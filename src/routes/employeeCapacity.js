const express = require("express");
const EmployeeCapacity = require("../models/EmployeeCapacity");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await EmployeeCapacity.find().sort({ employeeName: 1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Upsert capacity — manager/admin only.
router.put("/:employeeId", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const { weeklyHours, dailyHours, defaultTaskHours, employeeName } = req.body || {};
    const item = await EmployeeCapacity.findOneAndUpdate(
      { employeeId: req.params.employeeId },
      {
        employeeId: req.params.employeeId,
        ...(employeeName !== undefined ? { employeeName } : {}),
        ...(weeklyHours !== undefined ? { weeklyHours } : {}),
        ...(dailyHours !== undefined ? { dailyHours } : {}),
        ...(defaultTaskHours !== undefined ? { defaultTaskHours } : {}),
        updatedBy: req.user?.sub || null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
