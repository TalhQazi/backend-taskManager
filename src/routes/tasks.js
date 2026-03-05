const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");

const router = express.Router();

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "tasks");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  assignee: z.string().optional().default(""),
  assigneeInitials: z.string().optional().default(""),
  location: z.string().optional().default(""),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  attachmentFileName: z.string().optional().default(""),
  attachmentNote: z.string().optional().default(""),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Task.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;
    const createdAt = parsed.data.createdAt || new Date().toISOString().split("T")[0];
    const assigneeInitials =
      parsed.data.assigneeInitials ||
      (parsed.data.assignee
        ? parsed.data.assignee
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()
        : "");

    const created = await Task.create({
      ...parsed.data,
      createdAt,
      assigneeInitials,
      dueDate,
    });

    await checkAndFlagOffTheClock({
      employee: parsed.data.assignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_create",
      metadata: { taskId: String(created._id), title: created.title },
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    console.log("Upload endpoint hit");
    console.log("Request file:", req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : "No file");
    
    const body = req.body || {};
    const payload = {
      title: body.title,
      description: body.description,
      assignee: body.assignee,
      assigneeInitials: body.assigneeInitials,
      location: body.location,
      priority: body.priority,
      status: body.status,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      createdAt: body.createdAt,
      attachmentFileName: body.attachmentFileName,
      attachmentNote: body.attachmentNote,
    };

    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("Validation failed:", parsed.error);
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error } });
    }

    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;
    const createdAt = parsed.data.createdAt || new Date().toISOString().split("T")[0];
    const assigneeInitials =
      parsed.data.assigneeInitials ||
      (parsed.data.assignee
        ? parsed.data.assignee
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()
        : "");

    const f = req.file;
    let attachment = undefined;
    
    if (f) {
      console.log("Processing file:", f.originalname, "Size:", f.size);
      if (f.buffer) {
        const base64Data = f.buffer.toString("base64");
        console.log("Base64 length:", base64Data.length);
        attachment = {
          fileName: f.originalname,
          url: `data:${f.mimetype};base64,${base64Data}`,
          mimeType: f.mimetype,
          size: f.size,
        };
        console.log("Attachment created with URL length:", attachment.url.length);
      } else {
        console.error("File has no buffer!");
      }
    } else {
      console.log("No file uploaded");
    }

    console.log("Creating task with attachment:", attachment ? "yes" : "no");
    const created = await Task.create({
      ...parsed.data,
      createdAt,
      assigneeInitials,
      dueDate,
      attachmentFileName: f?.originalname || parsed.data.attachmentFileName || "",
      attachment,
    });

    await checkAndFlagOffTheClock({
      employee: parsed.data.assignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_create_with_attachment",
      metadata: { taskId: String(created._id), title: created.title },
    });

    console.log("Task created with ID:", created._id);
    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    console.error("Upload error:", err);
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    await checkAndFlagOffTheClock({
      employee: parsed.data.assignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_update",
      metadata: { taskId: String(req.params.id) },
    });

    const patch = { ...parsed.data };
    if (patch.dueDate) {
      patch.dueDate = new Date(patch.dueDate);
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Task.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
