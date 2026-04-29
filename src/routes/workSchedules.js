const express = require("express");
const { z } = require("zod");

const WorkSchedule = require("../models/WorkSchedule");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const scheduleSchema = z.object({
  userId: z.string().min(1),
  locationId: z.string().optional().default(""),
  shiftStart: z.string().regex(/^\d{1,2}:\d{2}$/),
  shiftEnd: z.string().regex(/^\d{1,2}:\d{2}$/),
  timezone: z.string().min(1).optional().default("America/New_York"),
  eodOffsetMinutes: z.number().int().optional().default(-10),
  isActive: z.boolean().optional().default(true),
});

router.get("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { userId } = req.query;
    const q = {};
    if (userId) q.userId = String(userId);

    const items = await WorkSchedule.find(q).sort({ updatedAt: -1 }).lean();
    return res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });

    const u = await User.findById(parsed.data.userId).select("_id").lean();
    if (!u) return res.status(400).json({ error: { message: "User not found" } });

    const created = await WorkSchedule.create({
      userId: parsed.data.userId,
      locationId: parsed.data.locationId,
      shiftStart: parsed.data.shiftStart,
      shiftEnd: parsed.data.shiftEnd,
      timezone: parsed.data.timezone,
      eodOffsetMinutes: parsed.data.eodOffsetMinutes,
      isActive: parsed.data.isActive,
    });

    return res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = scheduleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });

    const updated = await WorkSchedule.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "WorkSchedule not found" } });

    return res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await WorkSchedule.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "WorkSchedule not found" } });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
