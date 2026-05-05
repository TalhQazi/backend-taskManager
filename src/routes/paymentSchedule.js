const express = require("express");
const mongoose = require("mongoose");

const PaymentPlan = require("../models/PaymentPlan");
const PaymentSchedule = require("../models/PaymentSchedule");

const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

async function recomputePlanBalances(planId) {
  const [plan, schedule] = await Promise.all([
    PaymentPlan.findById(planId),
    PaymentSchedule.find({ planId }).lean(),
  ]);
  if (!plan) return null;

  const paidTotal = schedule
    .filter((s) => s.status === "paid")
    .reduce((acc, s) => acc + (Number(s.amount) || 0), 0);

  const remaining = Math.max(0, Number(plan.totalBalance || 0) - paidTotal);

  let nextStatus = plan.status;
  if (remaining <= 0) {
    nextStatus = "completed";
  } else {
    const hasMissed = schedule.some((s) => s.status === "missed");
    if (hasMissed) nextStatus = "defaulted";
  }

  plan.remainingBalance = remaining;
  plan.status = nextStatus;
  await plan.save();
  return plan;
}

router.post("/:id/paid", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid schedule ID" } });
    }

    const schedule = await PaymentSchedule.findById(id);
    if (!schedule) return res.status(404).json({ error: { message: "Payment schedule not found" } });

    schedule.status = "paid";
    schedule.paidAt = new Date();
    await schedule.save();

    const plan = await recomputePlanBalances(schedule.planId);

    res.json({ item: schedule.toObject(), plan: plan ? plan.toObject() : null });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/missed", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid schedule ID" } });
    }

    const schedule = await PaymentSchedule.findById(id);
    if (!schedule) return res.status(404).json({ error: { message: "Payment schedule not found" } });

    schedule.status = "missed";
    schedule.paidAt = null;
    await schedule.save();

    const plan = await recomputePlanBalances(schedule.planId);

    res.json({ item: schedule.toObject(), plan: plan ? plan.toObject() : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
