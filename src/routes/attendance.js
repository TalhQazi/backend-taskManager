const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const multer = require("multer");

const AttendanceEvent = require("../models/AttendanceEvent");
const Employee = require("../models/Employee");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");
const { uploadToS3 } = require("../lib/s3");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
});

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function getClientIp(req) {
  const hdr = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return hdr || String(req.socket?.remoteAddress || "");
}

async function requireEmployeeContext(req, res) {
  const userIdRaw = req.user?._id || req.user?.sub;
  const email = String(req.user?.email || "").trim().toLowerCase();
  const name = String(req.user?.name || req.user?.username || "").trim();

  if (!userIdRaw) {
    res.status(401).json({ error: { message: "Unauthorized" } });
    return null;
  }

  const userId = new mongoose.Types.ObjectId(String(userIdRaw));
  const emp = email ? await Employee.findOne({ email }).lean() : null;

  return {
    userId,
    employeeId: emp?._id ? new mongoose.Types.ObjectId(String(emp._id)) : userId,
    employeeName: String(emp?.name || name || "Unknown").trim() || "Unknown",
  };
}

// Upload attachment (doctor note, documentation)
router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: "No file provided" } });

    let url = "";
    try {
      url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "attendance");
    } catch {
      const base64Data = file.buffer.toString("base64");
      url = `data:${file.mimetype};base64,${base64Data}`;
    }

    return res.json({
      attachment: {
        fileName: file.originalname,
        url,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Employee: submit Call-Out
router.post("/call-outs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeContext(req, res);
    if (!ctx) return;

    const schema = z.object({
      date: z.string().min(1),
      shiftStart: z.string().optional().default(""),
      shiftEnd: z.string().optional().default(""),
      timezone: z.string().optional().default("America/New_York"),
      reasonCode: z.string().min(1),
      reasonText: z.string().optional().default(""),
      attachments: z
        .array(
          z.object({
            fileName: z.string().optional().default(""),
            url: z.string().optional().default(""),
            mimeType: z.string().optional().default(""),
            size: z.number().optional().default(0),
          })
        )
        .optional()
        .default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const created = await AttendanceEvent.create({
      userId: ctx.userId,
      employeeId: ctx.employeeId,
      employeeName: ctx.employeeName,
      type: "call_out",
      date: new Date(parsed.data.date),
      shiftStart: parsed.data.shiftStart,
      shiftEnd: parsed.data.shiftEnd,
      timezone: parsed.data.timezone,
      level: 4, // Call-outs are level 4 by default or updated by engine
      reasonCode: parsed.data.reasonCode,
      reasonText: parsed.data.reasonText,
      attachments: parsed.data.attachments,
      deviceInfo: req.headers["user-agent"]?.includes("Mobi") ? "mobile" : "web",
      ipAddress: getClientIp(req),
      metadata: {
        device: String(req.headers["user-agent"] || ""),
        ipAddress: getClientIp(req),
      },
    });

    // Notify management
    await createNotification({
      actor: ctx.employeeName,
      actorRole: "employee",
      action: "submitted",
      resourceType: "attendance",
      resourceName: "call-out",
      details: `Call-out for ${parsed.data.date}`,
      assignees: ["manager", "admin", "super-admin"],
      resourceId: String(created._id),
    });

    // Notify employee (confirmation)
    await createNotification({
      actor: "system",
      actorRole: "system",
      action: "confirmed",
      resourceType: "attendance",
      resourceName: "call-out",
      details: `Your call-out for ${parsed.data.date} has been recorded`,
      assignees: [String(ctx.userId)],
      resourceId: String(created._id),
    });

    return res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

// Employee: pending actions (late explanations)
router.get("/me/pending", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeContext(req, res);
    if (!ctx) return;

    const items = await AttendanceEvent.find({
      userId: ctx.userId,
      status: "open",
      type: "late_arrival",
      $or: [
        { "explanation.submittedAt": { $exists: false } },
        { "explanation.submittedAt": null },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Employee: submit late explanation
router.post("/late/:id/explain", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeContext(req, res);
    if (!ctx) return;

    const schema = z.object({
      reason: z.string().min(1),
      comments: z.string().optional().default(""),
      attachments: z
        .array(
          z.object({
            fileName: z.string().optional().default(""),
            url: z.string().optional().default(""),
            mimeType: z.string().optional().default(""),
            size: z.number().optional().default(0),
          })
        )
        .optional()
        .default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const event = await AttendanceEvent.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: { message: "Attendance event not found" } });
    }

    if (String(event.userId) !== String(ctx.userId)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    if (event.type !== "late_arrival") {
      return res.status(400).json({ error: { message: "Not a late arrival event" } });
    }

    event.explanation = {
      reason: parsed.data.reason,
      comments: parsed.data.comments,
      submittedAt: new Date(),
    };
    if (parsed.data.attachments) {
      event.attachments = parsed.data.attachments;
    }
    event.deviceInfo = req.headers["user-agent"]?.includes("Mobi") ? "mobile" : "web";
    event.ipAddress = getClientIp(req);

    await event.save();

    // Notify management
    await createNotification({
      actor: ctx.employeeName,
      actorRole: "employee",
      action: "submitted",
      resourceType: "attendance",
      resourceName: "late explanation",
      details: `Late explanation submitted (${event.minutesLate} min late)`,
      assignees: ["manager", "admin", "super-admin"],
      resourceId: String(event._id),
    });

    return res.json({ item: withId(event.toObject()) });
  } catch (err) {
    next(err);
  }
});

// Management: list attendance events
router.get("/all", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { status, type, employeeName, userId } = req.query;
    const filter = {};
    if (status) filter.status = String(status);
    if (type) filter.type = String(type);
    if (employeeName) filter.employeeName = new RegExp(String(employeeName), "i");
    if (userId) filter.userId = String(userId);

    const items = await AttendanceEvent.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Management: review / notes / archive
router.put("/:id/review", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(["reviewed", "archived"]),
      managerNotes: z.string().optional().default(""),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const event = await AttendanceEvent.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: { message: "Attendance event not found" } });
    }

    // Rule 11: Records are permanent. Only Archive or Review.
    // Managers can also add managerial notes.
    const validStatuses = ["reviewed", "archived"];
    if (parsed.data.status && !validStatuses.includes(parsed.data.status)) {
        return res.status(400).json({ error: { message: "Invalid status update. Records can only be reviewed or archived." } });
    }

    if (parsed.data.status) {
        event.status = parsed.data.status;
    }
    if (typeof parsed.data.managerNotes === "string") {
      event.managerNotes = parsed.data.managerNotes;
    }
    event.reviewedBy = new mongoose.Types.ObjectId(String(req.user?._id || req.user?.sub || ""));
    event.reviewedAt = new Date();

    await event.save();
    return res.json({ item: withId(event.toObject()) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
