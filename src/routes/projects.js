const mongoose = require("mongoose");
const express = require("express");
const { z } = require("zod");

const Project = require("../models/Project");
const Task = require("../models/Task");
const Archive = require("../models/Archive");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");

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
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.date().optional(),
  })).optional().default([]),
});

const logoSchema = z.object({
  fileName: z.string().optional().default(""),
  url: z.string().optional().default(""),
  mimeType: z.string().optional().default(""),
  size: z.number().optional().default(0),
}).optional();

const projectCreateSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional().default(""),
  assignees: z.array(z.string()).optional().default([]),
  logo: logoSchema,
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.date().optional(),
  })).optional().default([]),
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
      assignees: parsed.data.assignees || [],
      logo: parsed.data.logo || { fileName: "", url: "", mimeType: "", size: 0 },
      attachments: parsed.data.attachments || [],
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
      attachments: t.attachments || [],
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
      assignees: Array.isArray(parsed.data.assignees) ? parsed.data.assignees : [],
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

// Optimized GET all projects with task stats using aggregation
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();
    const { page, limit, skip } = parsePagination(req.query);
    const searchQ = String(req.query.search || "").trim();

    const matchStages = [];

    if (role !== "admin" && role !== "super-admin") {
      const username = String(req.user?.username || "").trim();
      const name = String(req.user?.name || "").trim();
      const candidates = [username, name].filter(Boolean);

      if (candidates.length === 0) {
        return res.json(paginatedResponse([], 0, page, limit));
      }

      const regexes = candidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));
      matchStages.push({ $match: { assignees: { $elemMatch: { $in: regexes } } } });
    }

    if (searchQ) {
      const searchRegex = new RegExp(escapeRegExp(searchQ), "i");
      matchStages.push({ $match: { $or: [{ name: searchRegex }, { description: searchRegex }] } });
    }

    const shapeStages = [
      {
        $lookup: {
          from: "tasks",
          localField: "_id",
          foreignField: "projectId",
          as: "tasks",
          pipeline: [{ $project: { status: 1, _id: 0 } }],
        },
      },
      {
        $addFields: {
          id: { $toString: "$_id" },
          taskCount: { $size: "$tasks" },
          status: {
            $switch: {
              branches: [
                { case: { $eq: [{ $size: "$tasks" }, 0] }, then: "No tasks" },
                { case: { $allElementsTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "completed"] } } } }, then: "Completed" },
                { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "in-progress"] } } } }, then: "In Progress" },
                { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "overdue"] } } } }, then: "Overdue" },
                { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "pending"] } } } }, then: "Pending" },
              ],
              default: "Active",
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          name: 1,
          description: 1,
          assignees: 1,
          logo: {
            fileName: { $ifNull: ["$logo.fileName", ""] },
            mimeType: { $ifNull: ["$logo.mimeType", ""] },
            size: { $ifNull: ["$logo.size", 0] },
          },
          attachments: {
            $map: {
              input: { $ifNull: ["$attachments", []] },
              as: "att",
              in: {
                fileName: "$$att.fileName",
                mimeType: "$$att.mimeType",
                size: "$$att.size",
                uploadedAt: "$$att.uploadedAt",
              },
            },
          },
          taskCount: 1,
          status: 1,
          createdAt: 1,
          createdByUserId: 1,
          createdByUsername: 1,
          createdByRole: 1,
        },
      },
    ];

    const pipeline = [
      ...matchStages,
      { $sort: { name: 1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }, ...shapeStages],
          total: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Project.aggregate(pipeline);
    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;

    return res.json(paginatedResponse(items, total, page, limit));
  } catch (err) {
    return next(err);
  }
});

// GET project logo only (avoids sending large base64 in list endpoint)
router.get("/:id/logo", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).select("logo").lean();
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });
    res.json({ logo: project.logo || { fileName: "", url: "", mimeType: "", size: 0 } });
  } catch (err) {
    next(err);
  }
});

// Optimized GET single project with tasks using aggregation
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const cacheKey = `project:${req.params.id}`;
    const cached = await cacheWrap(cacheKey, async () => {
      const projectResult = await Project.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
        {
          $lookup: {
            from: "tasks",
            localField: "_id",
            foreignField: "projectId",
            as: "tasks",
            pipeline: [
              { $sort: { createdAt: -1 } },
              {
                $project: {
                  _id: 0,
                  id: { $toString: "$_id" },
                  title: 1,
                  description: 1,
                  assignees: 1,
                  priority: 1,
                  status: 1,
                  dueDate: 1,
                  dueTime: 1,
                  location: 1,
                  createdAt: 1,
                  attachmentFileName: 1,
                  attachmentNote: 1,
                  attachment: {
                    fileName: { $ifNull: ["$attachment.fileName", ""] },
                    url: { $ifNull: ["$attachment.url", ""] },
                    mimeType: { $ifNull: ["$attachment.mimeType", ""] },
                    size: { $ifNull: ["$attachment.size", 0] },
                  },
                  attachments: {
                    $map: {
                      input: { $ifNull: ["$attachments", []] },
                      as: "att",
                      in: {
                        fileName: "$$att.fileName",
                        url: "$$att.url",
                        mimeType: "$$att.mimeType",
                        size: "$$att.size",
                        uploadedAt: "$$att.uploadedAt",
                      },
                    },
                  },
                }
              }
            ]
          }
        },
        {
          $addFields: {
            id: { $toString: "$_id" },
            taskCount: { $size: "$tasks" },
            status: {
              $switch: {
                branches: [
                  { case: { $eq: [{ $size: "$tasks" }, 0] }, then: "No tasks" },
                  { case: { $allElementsTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "completed"] } } } }, then: "Completed" },
                  { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "in-progress"] } } } }, then: "In Progress" },
                  { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "overdue"] } } } }, then: "Overdue" },
                  { case: { $anyElementTrue: { $map: { input: "$tasks", as: "t", in: { $eq: ["$$t.status", "pending"] } } } }, then: "Pending" }
                ],
                default: "Active"
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            id: 1,
            name: 1,
            description: 1,
            assignees: 1,
            logo: {
              fileName: { $ifNull: ["$logo.fileName", ""] },
              url: { $ifNull: ["$logo.url", ""] },
              mimeType: { $ifNull: ["$logo.mimeType", ""] },
              size: { $ifNull: ["$logo.size", 0] },
            },
            attachments: 1,
            tasks: 1,
            taskCount: 1,
            status: 1,
            createdAt: 1,
            createdByUserId: 1,
            createdByUsername: 1,
            createdByRole: 1
          }
        }
      ]);

      return projectResult.length > 0 ? projectResult[0] : null;
    }, 60);

    if (!cached) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    return res.json({ item: cached });
  } catch (err) {
    return next(err);
  }
});

const projectUpdateSchema = z.object({
  name: z.string().min(1, "Project name is required").optional(),
  description: z.string().optional(),
  assignees: z.array(z.string()).optional().default([]),
  logo: logoSchema,
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.date().optional(),
  })).optional().default([]),
  status: z.string().optional(),
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    // Update fields
    if (parsed.data.name !== undefined) project.name = parsed.data.name;
    if (parsed.data.description !== undefined) project.description = parsed.data.description;
    if (parsed.data.assignees !== undefined) project.assignees = parsed.data.assignees;
    if (parsed.data.logo !== undefined) project.logo = parsed.data.logo;
    if (parsed.data.attachments !== undefined) project.attachments = parsed.data.attachments;
    if (parsed.data.status !== undefined) project.status = parsed.data.status;

    await project.save();
    void cacheDel(`project:${req.params.id}`);

    await logActivity(
      req,
      "PROJECT_UPDATE",
      "project",
      project._id,
      project.name,
      `Updated project: ${project.name}`
    );

    void createNotification({
      actor: String(req.user?.username || req.user?.name || "System"),
      actorRole: String(req.user?.role || ""),
      action: "updated",
      resourceType: "project",
      resourceName: project.name,
      resourceId: String(project._id),
    });

    return res.json({ item: withId(project.toObject()) });
  } catch (err) {
    return next(err);
  }
});

// Reassign project endpoint
router.put("/:id/reassign", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    const assignees = normalizeAssignees(req.body?.assignees);
    if (assignees.length === 0) {
      return res.status(400).json({ error: { message: "At least one assignee is required" } });
    }

    project.assignees = assignees;
    await project.save();
    void cacheDel(`project:${req.params.id}`);

    // Log activity
    await logActivity(req, "PROJECT_REASSIGN", "project", req.params.id, project.name, `Reassigned project: ${project.name} to ${assignees.join(", ")}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "reassigned",
      resourceType: "project",
      resourceName: project.name,
      resourceId: String(req.params.id),
      details: `New assignees: ${assignees.join(", ")}`,
    });

    return res.json({ item: withId(project.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    // Archive project (soft delete)
    await Archive.create({
      itemType: "project",
      itemData: {
        originalId: String(project._id),
        name: project.name,
        description: project.description,
        assignees: project.assignees,
        logo: project.logo,
        attachments: project.attachments,
        createdAt: project.createdAt,
        createdByUserId: project.createdByUserId,
        createdByUsername: project.createdByUsername,
        createdByRole: project.createdByRole,
      },
      parentType: "standalone",
      parentId: String(project._id),
      parentName: project.name,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.username || req.user?.name || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    // Archive associated tasks in bulk
    const projectTasks = await Task.find({ projectId: project._id }).lean();
    if (projectTasks.length > 0) {
      const taskArchiveEntries = projectTasks.map((task) => ({
        itemType: "task",
        itemData: {
          originalId: String(task._id),
          title: task.title,
          description: task.description,
          assignees: task.assignees,
          priority: task.priority,
          status: task.status,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          location: task.location,
          projectId: task.projectId,
          attachment: task.attachment,
          attachments: task.attachments,
          createdAt: task.createdAt,
        },
        parentType: "project",
        parentId: String(project._id),
        parentName: project.name,
        archivedByUserId: String(req.user?.sub || req.user?.id || ""),
        archivedByUsername: String(req.user?.username || ""),
        archivedByRole: String(req.user?.role || ""),
      }));
      await Archive.insertMany(taskArchiveEntries);
    }

    // Delete associated tasks
    await Task.deleteMany({ projectId: project._id });

    // Delete the project
    await Project.findByIdAndDelete(req.params.id);
    void cacheDel(`project:${req.params.id}`);

    await logActivity(
      req,
      "PROJECT_ARCHIVE",
      "project",
      project._id,
      project.name,
      `Archived project: ${project.name}`
    );

    void createNotification({
      actor: String(req.user?.username || req.user?.name || "System"),
      actorRole: String(req.user?.role || ""),
      action: "archived",
      resourceType: "project",
      resourceName: project.name,
      resourceId: String(project._id),
    });

    return res.json({ success: true, message: "Project archived successfully" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
