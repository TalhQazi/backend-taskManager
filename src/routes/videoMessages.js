const express = require("express");
const { z } = require("zod");
const Employee = require("../models/Employee");
const Milestone = require("../models/Milestone");
const VideoMessage = require("../models/VideoMessage");
const VideoDelivery = require("../models/VideoDelivery");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const historyRouter = express.Router();

const MESSAGE_TYPES = [
  "birthday",
  "30d",
  "6m",
  "1y",
  "2y",
  "3y",
  "4y",
  "5y",
  "6y",
  "7y",
  "8y",
  "9y",
  "10y",
  "top-performer",
];

const messageSchema = z.object({
  type: z.enum(MESSAGE_TYPES),
  title: z.string().min(1),
  subtitle: z.string().optional().default(""),
  videoUrl: z.string().min(1),
  isActive: z.boolean().optional().default(true),
});

const updateMessageSchema = messageSchema.partial();

const deliverSchema = z.object({});

const acknowledgeSchema = z.object({
  deliveryId: z.string().min(1),
  response: z.string().optional().default(""),
  watchDuration: z.number().min(0).optional(),
  replayCount: z.number().min(0).optional(),
});

const replaySchema = z.object({
  deliveryId: z.string().min(1),
});

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { __v, ...rest } = obj;
  return { ...rest, id: String(doc._id) };
}

function normalizeDateToDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function dayAfter(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  return day;
}

async function getPendingEventForEmployee(employee) {
  if (!employee) return null;

  const now = new Date();

  if (employee.birthDate) {
    const birthDate = new Date(String(employee.birthDate));
    if (!Number.isNaN(birthDate.getTime())) {
      const today = now;
      if (birthDate.getDate() === today.getDate() && birthDate.getMonth() === today.getMonth()) {
        const existing = await VideoDelivery.findOne({
          employeeId: employee._id,
          messageType: "birthday",
          deliveredAt: { $gte: normalizeDateToDay(now), $lt: dayAfter(now) },
        }).lean();
        if (!existing) {
          return { messageType: "birthday" };
        }
      }
    }
  }

  if (employee.milestoneOverlayActive && employee.milestoneOverlayExpires && new Date(employee.milestoneOverlayExpires) > now) {
    const milestoneType = String(employee.milestoneLevel || "");
    if (MESSAGE_TYPES.includes(milestoneType) && milestoneType !== "birthday") {
      const latestDelivery = await VideoDelivery.findOne({
        employeeId: employee._id,
        messageType: milestoneType,
      })
        .sort({ deliveredAt: -1 })
        .lean();

      if (!latestDelivery) {
        return { messageType: milestoneType };
      }

      const deliveredDay = latestDelivery.deliveredAt ? normalizeDateToDay(latestDelivery.deliveredAt) : null;
      if (!deliveredDay || deliveredDay.getTime() !== normalizeDateToDay(now).getTime()) {
        return { messageType: milestoneType };
      }
    }
  }

  return null;
}

router.get("/messages", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const messages = await VideoMessage.find().sort({ type: 1 }).lean();
    res.json({ items: messages.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/messages", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }
    const message = await VideoMessage.create({
      ...parsed.data,
      createdBy: req.user?._id || null,
    });
    res.status(201).json({ item: withId(message) });
  } catch (err) {
    next(err);
  }
});

router.put("/messages/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const message = await VideoMessage.findById(String(req.params.id));
    if (!message) {
      return res.status(404).json({ error: { message: "Video message not found" } });
    }

    Object.assign(message, parsed.data);
    await message.save();

    res.json({ item: withId(message) });
  } catch (err) {
    next(err);
  }
});

router.delete("/messages/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const message = await VideoMessage.findByIdAndDelete(String(req.params.id));
    if (!message) {
      return res.status(404).json({ error: { message: "Video message not found" } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/messages/:type", requireAuth, async (req, res, next) => {
  try {
    const type = req.params.type;
    if (!MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ error: { message: "Invalid video message type" } });
    }
    const message = await VideoMessage.findOne({ type, isActive: true }).sort({ updatedAt: -1 }).lean();
    if (!message) {
      return res.status(404).json({ error: { message: "Video message not found" } });
    }
    res.json({ item: withId(message) });
  } catch (err) {
    next(err);
  }
});

router.post("/deliver", requireAuth, async (req, res, next) => {
  try {
    const parsed = deliverSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const userId = String(req.user?.sub || req.user?.id || "");
    const employee = await Employee.findById(userId).lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const event = await getPendingEventForEmployee(employee);
    if (!event || !event.messageType) {
      return res.json({ item: null });
    }

    const message = await VideoMessage.findOne({ type: event.messageType, isActive: true }).lean();
    if (!message) {
      return res.status(404).json({ error: { message: "Video message not found" } });
    }

    const today = normalizeDateToDay(new Date());
    const existing = await VideoDelivery.findOne({
      employeeId: employee._id,
      messageType: event.messageType,
      deliveredAt: { $gte: today, $lt: dayAfter(today) },
    }).lean();

    if (existing) {
      return res.json({
        item: {
          deliveryId: String(existing._id),
          messageType: existing.messageType,
          title: message.title,
          subtitle: message.subtitle,
          videoUrl: message.videoUrl,
          deliveredAt: existing.deliveredAt,
          acknowledgedAt: existing.acknowledgedAt,
        },
      });
    }

    const delivery = await VideoDelivery.create({
      employeeId: employee._id,
      videoMessageId: message._id,
      messageType: event.messageType,
      deliveredAt: new Date(),
    });

    res.status(201).json({
      item: {
        deliveryId: String(delivery._id),
        messageType: delivery.messageType,
        title: message.title,
        subtitle: message.subtitle,
        videoUrl: message.videoUrl,
        deliveredAt: delivery.deliveredAt,
        acknowledgedAt: delivery.acknowledgedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/acknowledge", requireAuth, async (req, res, next) => {
  try {
    const parsed = acknowledgeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const delivery = await VideoDelivery.findById(String(parsed.data.deliveryId));
    if (!delivery) {
      return res.status(404).json({ error: { message: "Delivery record not found" } });
    }

    delivery.acknowledgedAt = new Date();
    if (parsed.data.response) {
      delivery.response = parsed.data.response;
    }
    if (typeof parsed.data.watchDuration === "number") {
      delivery.watchDuration = parsed.data.watchDuration;
    }
    if (typeof parsed.data.replayCount === "number") {
      delivery.replayCount = parsed.data.replayCount;
    }
    await delivery.save();

    res.json({ item: withId(delivery) });
  } catch (err) {
    next(err);
  }
});

router.post("/replay", requireAuth, async (req, res, next) => {
  try {
    const parsed = replaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const delivery = await VideoDelivery.findById(String(parsed.data.deliveryId));
    if (!delivery) {
      return res.status(404).json({ error: { message: "Delivery record not found" } });
    }

    delivery.replayCount = (delivery.replayCount || 0) + 1;
    await delivery.save();

    res.json({ item: withId(delivery) });
  } catch (err) {
    next(err);
  }
});

historyRouter.get("/:id/video-history", requireAuth, async (req, res, next) => {
  try {
    const requestedId = String(req.params.id || "");
    const viewerRole = String(req.user?.role || "");
    const viewerId = String(req.user?.sub || req.user?.id || "");

    if (viewerRole === "employee" && requestedId !== viewerId) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const deliveries = await VideoDelivery.find({ employeeId: requestedId })
      .sort({ deliveredAt: -1 })
      .populate("videoMessageId")
      .lean();

    const items = deliveries.map((delivery) => ({
      id: String(delivery._id),
      employeeId: String(delivery.employeeId),
      videoMessageId: String(delivery.videoMessageId?._id || ""),
      messageType: delivery.messageType,
      deliveredAt: delivery.deliveredAt,
      acknowledgedAt: delivery.acknowledgedAt,
      watchDuration: delivery.watchDuration,
      response: delivery.response,
      replayCount: delivery.replayCount,
      videoTitle: delivery.videoMessageId?.title || "",
      videoSubtitle: delivery.videoMessageId?.subtitle || "",
      videoUrl: delivery.videoMessageId?.videoUrl || "",
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, historyRouter };
