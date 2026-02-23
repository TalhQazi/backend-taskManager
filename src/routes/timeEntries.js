const express = require("express");
const { z } = require("zod");

const TimeEntry = require("../models/TimeEntry");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  employee: z.string().min(1),
  avatar: z.string().optional().default(""),
  date: z.union([z.string(), z.date()]),
  clockIn: z.string().optional().default(""),
  clockOut: z.string().optional().default(""),
  breakTime: z.string().optional().default(""),
  totalHours: z.number().optional().default(0),
  status: z.enum(["complete", "incomplete", "overtime"]).optional(),
  location: z.string().optional().default(""),
});

const adminUiSchema = z.object({
  employee: z.string().min(1),
  initials: z.string().optional(),
  location: z.string().min(1),
  date: z.string().min(1),
  clockIn: z.string().min(1),
  clockOut: z.string().nullable().optional(),
  status: z.string().optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await TimeEntry.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const created = await TimeEntry.create({
        employee: adminParsed.data.employee,
        avatar: "",
        date: new Date(adminParsed.data.date),
        clockIn: adminParsed.data.clockIn,
        clockOut: adminParsed.data.clockOut || "",
        breakTime: "",
        totalHours: 0,
        status: adminParsed.data.clockOut ? "complete" : "incomplete",
        location: adminParsed.data.location,
      });
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const created = await TimeEntry.create({
      ...parsed.data,
      date: new Date(parsed.data.date),
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.partial().safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};
      if (typeof adminParsed.data.employee === "string") patch.employee = adminParsed.data.employee;
      if (typeof adminParsed.data.location === "string") patch.location = adminParsed.data.location;
      if (typeof adminParsed.data.clockIn === "string") patch.clockIn = adminParsed.data.clockIn;
      if (typeof adminParsed.data.clockOut === "string" || adminParsed.data.clockOut === null) {
        patch.clockOut = adminParsed.data.clockOut || "";
      }
      if (typeof adminParsed.data.date === "string") patch.date = new Date(adminParsed.data.date);

      if (patch.clockOut) patch.status = "complete";
      else patch.status = "incomplete";

      const updated = await TimeEntry.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Time entry not found" } });
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (patch.date) patch.date = new Date(patch.date);

    const updated = await TimeEntry.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Time entry not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await TimeEntry.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Time entry not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
