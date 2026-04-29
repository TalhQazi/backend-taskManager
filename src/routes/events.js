const express = require("express");
const { z } = require("zod");

const Event = require("../models/Event");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { cacheWrap, cacheDel } = require("../lib/cache");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const adminScheduleSchema = z.object({
  location: z.string().min(1),
  employee: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().optional().default(""),
  endTime: z.string().optional().default(""),
  plannedTask: z.string().optional().default(""),
});

const createSchema = z.object({
  day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
  title: z.string().min(1),
  assignee: z.string().min(1),
  location: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  type: z.enum(["task", "meeting", "break", "training"]),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const result = await cacheWrap("events:list", async () => {
      const items = await Event.find().sort({ createdAt: -1 }).lean();
      return { items: items.map(withId) };
    }, 30);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminScheduleSchema.safeParse(req.body);
    if (adminParsed.success) {
      const d = new Date(adminParsed.data.date);
      const dayIndex = d.getDay();
      const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const created = await Event.create({
        day: dayMap[Number.isFinite(dayIndex) ? dayIndex : 1],
        title: adminParsed.data.plannedTask || "Shift",
        assignee: adminParsed.data.employee,
        location: adminParsed.data.location,
        startTime: adminParsed.data.startTime || "",
        endTime: adminParsed.data.endTime || "",
        type: "task",
      });
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "event",
        resourceName: created.title,
        details: created.assignee ? `Assigned to: ${created.assignee}` : "",
      });
      
      cacheDel("events:list");
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    await checkAndFlagOffTheClock({
      employee: parsed.data.assignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "event_create",
      metadata: { title: parsed.data.title, type: parsed.data.type },
    });

    const created = await Event.create(parsed.data);

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "event",
      resourceName: created.title,
      details: created.assignee ? `Assigned to: ${created.assignee}` : "",
    });
    cacheDel("events:list");
    res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminScheduleSchema.partial().safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};

      if (typeof adminParsed.data.location === "string") patch.location = adminParsed.data.location;
      if (typeof adminParsed.data.employee === "string") patch.assignee = adminParsed.data.employee;
      if (typeof adminParsed.data.plannedTask === "string") patch.title = adminParsed.data.plannedTask || "Shift";
      if (typeof adminParsed.data.startTime === "string") patch.startTime = adminParsed.data.startTime;
      if (typeof adminParsed.data.endTime === "string") patch.endTime = adminParsed.data.endTime;
      if (typeof adminParsed.data.date === "string") {
        const d = new Date(adminParsed.data.date);
        const dayIndex = d.getDay();
        const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        patch.day = dayMap[Number.isFinite(dayIndex) ? dayIndex : 1];
      }
      patch.type = "task";

      const updated = await Event.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Event not found" } });
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "updated",
        resourceType: "event",
        resourceName: updated.title,
        details: patch.assignee ? `Reassigned to: ${patch.assignee}` : "",
      });
      
      cacheDel("events:list");
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    await checkAndFlagOffTheClock({
      employee: parsed.data.assignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "event_update",
      metadata: { eventId: String(req.params.id) },
    });

    const updated = await Event.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Event not found" } });

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "event",
      resourceName: updated.title,
    });
    cacheDel("events:list");
    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Event.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Event not found" } });
    
    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "event",
      resourceName: deleted.title,
    });
    cacheDel("events:list");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
