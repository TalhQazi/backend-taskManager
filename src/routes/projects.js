const express = require("express");
const { z } = require("zod");

const Project = require("../models/Project");
const Task = require("../models/Task");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  const legacyAssignee = typeof doc.assignee === "string" ? doc.assignee : "";
  const nextAssignees = Array.isArray(doc.assignees)
    ? doc.assignees
    : legacyAssignee
      ? [legacyAssignee]
      : [];
  const { assignee, assigneeInitials, location, ...rest } = doc;
  return { ...rest, assignees: nextAssignees, id: String(doc._id) };
}

function normalizeAssignees(input) {
  if (Array.isArray(input)) return input.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  if (typeof input === "string") {
    const v = input.trim();
    return v ? [v] : [];
  }
  return [];
}

async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

const taskCreateSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().min(1, "Task description is required"),
  assignees: z.array(z.string()).optional().default([]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  attachmentFileName: z.string().optional().default(""),
  attachmentNote: z.string().optional().default(""),
  attachment: z
    .object({
      fileName: z.string().optional().default(""),
      url: z.string().optional().default(""),
      mimeType: z.string().optional().default(""),
      size: z.number().optional().default(0),
    })
    .optional(),
});

const projectCreateSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional().default(""),
  tasks: z.array(taskCreateSchema).min(1, "At least one task is required"),
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = projectCreateSchema.safeParse({
      ...req.body,
      tasks: Array.isArray(req.body?.tasks)
        ? req.body.tasks.map((t) => ({
            ...t,
            assignees: normalizeAssignees(t?.assignees ?? t?.assignee),
          }))
        : req.body?.tasks,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const createdProject = await Project.create({
      name: parsed.data.name,
      description: parsed.data.description || "",
      createdByUserId: String(req.user?.sub || req.user?.id || ""),
      createdByUsername: String(req.user?.username || req.user?.name || ""),
      createdByRole: String(req.user?.role || ""),
    });

    const nowDate = new Date().toISOString().split("T")[0];

    const taskDocs = parsed.data.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      assignees: normalizeAssignees(t.assignees),
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
      dueTime: t.dueTime,
      createdAt: t.createdAt || nowDate,
      attachmentFileName: t.attachmentFileName || t.attachment?.fileName || "",
      attachmentNote: t.attachmentNote || "",
      attachment: t.attachment,
      projectId: createdProject._id,
    }));

    const createdTasks = await Task.insertMany(taskDocs, { ordered: true });

    await logActivity(
      req,
      "PROJECT_CREATE",
      "project",
      createdProject._id,
      createdProject.name,
      `Created project: ${createdProject.name}`
    );

    void createNotification({
      actor: String(req.user?.username || req.user?.name || "System"),
      actorRole: String(req.user?.role || ""),
      action: "created",
      resourceType: "project",
      resourceName: createdProject.name,
      details: `Tasks: ${createdTasks.length}`,
      resourceId: String(createdProject._id),
    });

    return res.status(201).json({
      item: {
        ...withId(createdProject.toObject()),
        tasks: createdTasks.map((t) => withId(t.toObject ? t.toObject() : t)),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Project.find().sort({ createdAt: -1 }).lean();
    return res.json({ items: items.map(withId) });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });

    const tasks = await Task.find({ projectId: project._id }).sort({ createdAt: -1 }).lean();

    return res.json({
      item: {
        ...withId(project),
        tasks: tasks.map(withId),
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
