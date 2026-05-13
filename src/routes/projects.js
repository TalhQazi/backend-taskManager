const mongoose = require("mongoose");
const express = require("express");
const { z } = require("zod");

const Project = require("../models/Project");
const Task = require("../models/Task");
const ProjectComment = require("../models/ProjectComment");
const Settings = require("../models/Settings");
const Employee = require("../models/Employee");
const Archive = require("../models/Archive");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");
const { extractMentions } = require("../utils/mentions");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { uploadToS3, base64ToBuffer } = require("../lib/s3");

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
      actorUsername: String(req.user?.name || req.user?.username || "unknown"),
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
  fileName: z.string().optional(),
  url: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
}).optional();

const projectCreateSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional().default(""),
  assignees: z.array(z.string()).optional().default([]),
  teamLead: z.string().optional().default(""),
  logo: logoSchema,
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.date().optional(),
  })).optional().default([]),
  dropboxAttachments: z.array(z.object({
    file_name: z.string(),
    file_type: z.string().optional().default(""),
    file_size: z.number().optional().default(0),
    dropbox_file_id: z.string(),
    dropbox_path: z.string(),
    temporary_link: z.string().optional().default(""),
  })).optional().default([]),
  tasks: z.array(taskCreateSchema).optional().default([]),
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

    const data = { ...parsed.data };

    // 1. Upload Project Logo to S3
    if (data.logo?.url && data.logo.url.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(data.logo.url);
        const s3Url = await uploadToS3(buffer, data.logo.fileName || "logo", mimeType, "projects/logos");
        data.logo.url = s3Url;
      } catch (err) {
        console.error("Failed to upload project logo to S3:", err);
      }
    }

    // 2. Upload Project Attachments to S3
    if (Array.isArray(data.attachments) && data.attachments.length > 0) {
      data.attachments = await Promise.all(data.attachments.map(async (att) => {
        if (att.url && att.url.startsWith("data:")) {
          try {
            const { buffer, mimeType } = base64ToBuffer(att.url);
            const s3Url = await uploadToS3(buffer, att.fileName || "attachment", mimeType, "projects/attachments");
            return { ...att, url: s3Url, uploadedAt: att.uploadedAt || new Date() };
          } catch (err) {
            console.error("Failed to upload project attachment to S3:", err);
            return att;
          }
        }
        return att;
      }));
    }

    const createdProject = await Project.create({
      name: data.name,
      description: data.description || "",
      assignees: data.assignees || [],
      teamLead: data.teamLead || "",
      logo: data.logo || { fileName: "", url: "", mimeType: "", size: 0 },
      attachments: data.attachments || [],
      dropboxAttachments: data.dropboxAttachments || [],
      createdByUserId: String(req.user?.sub || req.user?.id || ""),
      createdByUsername: String(req.user?.name || req.user?.username || ""),
      createdByRole: String(req.user?.role || ""),
    });

    const nowDate = new Date().toISOString().split("T")[0];

    // 3. Upload Nested Task Attachments to S3
    const taskDocs = await Promise.all(data.tasks.map(async (t) => {
      let attachment = t.attachment;
      if (attachment?.url && attachment.url.startsWith("data:")) {
        try {
          const { buffer, mimeType } = base64ToBuffer(attachment.url);
          const s3Url = await uploadToS3(buffer, attachment.fileName || "attachment", mimeType, "tasks");
          attachment.url = s3Url;
        } catch (err) {
          console.error("Failed to upload nested task primary attachment to S3:", err);
        }
      }

      let attachments = t.attachments || [];
      if (attachments.length > 0) {
        attachments = await Promise.all(attachments.map(async (att) => {
          if (att.url && att.url.startsWith("data:")) {
            try {
              const { buffer, mimeType } = base64ToBuffer(att.url);
              const s3Url = await uploadToS3(buffer, att.fileName || "attachment", mimeType, "tasks");
              return { ...att, url: s3Url, uploadedAt: att.uploadedAt || new Date() };
            } catch (err) {
              console.error("Failed to upload nested task multi-attachment to S3:", err);
              return att;
            }
          }
          return att;
        }));
      }

      return {
        title: t.title,
        description: t.description,
        assignees: normalizeAssignees(t.assignees),
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
        dueTime: t.dueTime,
        createdAt: t.createdAt || nowDate,
        attachmentFileName: t.attachmentFileName || attachment?.fileName || "",
        attachmentNote: t.attachmentNote || "",
        attachment,
        attachments,
        projectId: createdProject._id,
      };
    }));

    const createdTasks = taskDocs.length > 0 ? await Task.insertMany(taskDocs, { ordered: true }) : [];

    await logActivity(
      req,
      "PROJECT_CREATE",
      "project",
      createdProject._id,
      createdProject.name,
      `Created project: ${createdProject.name}`
    );

    void createNotification({
      actor: String(req.user?.name || req.user?.username || "System"),
      actorRole: String(req.user?.role || ""),
      action: "created",
      resourceType: "project",
      resourceName: createdProject.name,
      assignees: Array.isArray(data.assignees) ? data.assignees : [],
      details: `Tasks: ${createdTasks.length}`,
      resourceId: String(createdProject._id),
      category: "PROJECT_ASSIGNED",
    });

    // Extract mentions from description
    const mentionedUsers = await extractMentions(data.description);
    if (mentionedUsers.length > 0) {
      await createNotification({
        actor: String(req.user?.name || req.user?.username || "System"),
        actorRole: String(req.user?.role || ""),
        action: "mentioned you in project",
        resourceType: "project",
        resourceName: createdProject.name,
        assignees: mentionedUsers,
        details: `"${data.description.length > 50 ? data.description.substring(0, 50) + "..." : data.description}"`,
        resourceId: String(createdProject._id),
        category: "MENTIONED",
      });
    }

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

      // For managers and team-leads, filter by teamLead field
      if (role === "manager" || role === "team-lead") {
        const regexes = candidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));
        matchStages.push({
          $match: {
            $or: [
              { teamLead: { $in: regexes } },
              { assignees: { $elemMatch: { $in: regexes } } }
            ]
          }
        });
      } else {
        const regexes = candidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));
        matchStages.push({ $match: { assignees: { $elemMatch: { $in: regexes } } } });
      }
    }

    if (searchQ) {
      const searchRegex = new RegExp(escapeRegExp(searchQ), "i");
      matchStages.push({ 
        $match: { 
          $or: [
            { name: searchRegex }, 
            { description: searchRegex },
            { assignees: { $elemMatch: { $regex: searchRegex } } }
          ] 
        } 
      });
    }

    const shapeStages = [
      {
        $lookup: {
          from: "tasks",
          localField: "_id",
          foreignField: "projectId",
          as: "tasks",
          pipeline: [{ $project: { status: 1, attachment: 1, attachments: 1, _id: 0 } }],
        },
      },
      {
        $addFields: {
          id: { $toString: "$_id" },
          taskCount: { $size: "$tasks" },
          taskAttachmentStats: {
            $reduce: {
              input: "$tasks",
              initialValue: { images: 0, files: 0 },
              in: {
                $let: {
                  vars: {
                    // Merge attachment and attachments, ensuring uniqueness by URL
                    taskAtts: {
                      $reduce: {
                        input: { $ifNull: ["$$this.attachments", []] },
                        initialValue: { 
                          $cond: [
                            { $and: [
                              { $gt: [{ $ifNull: ["$$this.attachment.url", null] }, null] }, 
                              { $ne: ["$$this.attachment.url", ""] }
                            ] }, 
                            ["$$this.attachment"], 
                            []
                          ] 
                        },
                        in: {
                          $cond: [
                            { $in: ["$$this.url", { $map: { input: "$$value", as: "v", in: "$$v.url" } }] },
                            "$$value",
                            { $concatArrays: ["$$value", ["$$this"]] }
                          ]
                        }
                      }
                    }
                  },
                  in: {
                    images: {
                      $add: [
                        "$$value.images",
                        {
                          $size: {
                            $filter: {
                              input: "$$taskAtts",
                              as: "att",
                              cond: {
                                $or: [
                                  { $regexMatch: { input: { $ifNull: ["$$att.mimeType", ""] }, regex: "^image/", options: "i" } },
                                  { $regexMatch: { input: { $ifNull: ["$$att.fileName", ""] }, regex: "\\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$", options: "i" } }
                                ]
                              }
                            }
                          }
                        }
                      ]
                    },
                    files: {
                      $add: [
                        "$$value.files",
                        {
                          $size: {
                            $filter: {
                              input: "$$taskAtts",
                              as: "att",
                              cond: {
                                $and: [
                                  { $ne: [{ $ifNull: ["$$att.url", ""] }, ""] },
                                  { $not: {
                                    $or: [
                                      { $regexMatch: { input: { $ifNull: ["$$att.mimeType", ""] }, regex: "^image/", options: "i" } },
                                      { $regexMatch: { input: { $ifNull: ["$$att.fileName", ""] }, regex: "\\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$", options: "i" } }
                                    ]
                                  }}
                                ]
                              }
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
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
          teamLead: 1,
          logo: {
            fileName: { $ifNull: ["$logo.fileName", ""] },
            url: { 
              $cond: {
                if: { $eq: [{ $substrCP: [{ $ifNull: ["$logo.url", ""] }, 0, 5] }, "data:"] },
                then: "", 
                else: { $ifNull: ["$logo.url", ""] }
              }
            },
            mimeType: { $ifNull: ["$logo.mimeType", ""] },
            size: { $ifNull: ["$logo.size", 0] },
          },
          attachments: {
            $map: {
              input: { $ifNull: ["$attachments", []] },
              as: "att",
              in: {
                fileName: "$$att.fileName",
                url: { $ifNull: ["$$att.url", ""] },
                mimeType: "$$att.mimeType",
                size: "$$att.size",
                uploadedAt: "$$att.uploadedAt",
              },
            },
          },
          dropboxAttachments: {
            $map: {
              input: { $ifNull: ["$dropboxAttachments", []] },
              as: "dbf",
              in: {
                id: "$$dbf._id",
                file_name: "$$dbf.file_name",
                file_type: "$$dbf.file_type",
                file_size: "$$dbf.file_size",
                dropbox_file_id: "$$dbf.dropbox_file_id",
                dropbox_path: "$$dbf.dropbox_path",
                temporary_link: "$$dbf.temporary_link",
                created_at: "$$dbf.created_at",
              },
            },
          },
          taskCount: 1,
          taskAttachmentStats: 1,
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
                  assignees: { $ifNull: ["$assignees", { $cond: [{ $ifNull: ["$assignee", false] }, ["$assignee"], []] }] },
                  teamLead: 1,
                  priority: 1,
                  status: 1,
                  taskNumber: 1,
                  executionPriority: 1,
                  dueDate: 1,
                  dueTime: 1,
                  location: 1,
                  createdAt: 1,
                  attachmentFileName: 1,
                  attachmentNote: 1,
                  attachment: {
                    fileName: { $ifNull: ["$attachment.fileName", ""] },
                    url: { 
                      $cond: {
                        if: { $eq: [{ $substrCP: [{ $ifNull: ["$attachment.url", ""] }, 0, 5] }, "data:"] },
                        then: "",
                        else: { $ifNull: ["$attachment.url", ""] }
                      }
                    },
                    mimeType: { $ifNull: ["$attachment.mimeType", ""] },
                    size: { $ifNull: ["$attachment.size", 0] },
                  },
                  attachments: {
                    $map: {
                      input: { $ifNull: ["$attachments", []] },
                      as: "att",
                      in: {
                        fileName: "$$att.fileName",
                        url: {
                          $cond: {
                            if: { $eq: [{ $substrCP: [{ $ifNull: ["$$att.url", ""] }, 0, 5] }, "data:"] },
                            then: "",
                            else: { $ifNull: ["$$att.url", ""] }
                          }
                        },
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
            teamLead: 1,
            logo: {
              fileName: { $ifNull: ["$logo.fileName", ""] },
              url: { $ifNull: ["$logo.url", ""] },
              mimeType: { $ifNull: ["$logo.mimeType", ""] },
              size: { $ifNull: ["$logo.size", 0] },
            },
            attachments: {
              $map: {
                input: { $ifNull: ["$attachments", []] },
                as: "att",
                in: {
                  fileName: "$$att.fileName",
                  url: {
                    $cond: {
                      if: { $eq: [{ $substrCP: [{ $ifNull: ["$$att.url", ""] }, 0, 5] }, "data:"] },
                      then: "",
                      else: { $ifNull: ["$$att.url", ""] }
                    }
                  },
                  mimeType: "$$att.mimeType",
                  size: "$$att.size",
                  uploadedAt: "$$att.uploadedAt",
                },
              },
            },
            dropboxAttachments: {
              $map: {
                input: { $ifNull: ["$dropboxAttachments", []] },
                as: "dbf",
                in: {
                  id: "$$dbf._id",
                  file_name: "$$dbf.file_name",
                  file_type: "$$dbf.file_type",
                  file_size: "$$dbf.file_size",
                  dropbox_file_id: "$$dbf.dropbox_file_id",
                  dropbox_path: "$$dbf.dropbox_path",
                  temporary_link: "$$dbf.temporary_link",
                  created_at: "$$dbf.created_at",
                },
              },
            },
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
  assignees: z.array(z.string()).optional(),
  teamLead: z.string().optional(),
  logo: logoSchema,
  attachments: z.array(z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    uploadedAt: z.union([z.date(), z.string()]).optional(),
  })).optional(),
  dropboxAttachments: z.array(z.object({
    file_name: z.string(),
    file_type: z.string().optional().default(""),
    file_size: z.number().optional().default(0),
    dropbox_file_id: z.string(),
    dropbox_path: z.string(),
    temporary_link: z.string().optional().default(""),
  })).optional(),
  status: z.string().optional(),
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    // Debug: Log incoming logo payload info (not the full base64)
    if (req.body?.logo) {
      console.log("[ProjectUpdate] Logo payload received:", {
        fileName: req.body.logo.fileName,
        mimeType: req.body.logo.mimeType,
        size: req.body.logo.size,
        urlPrefix: req.body.logo.url ? req.body.logo.url.substring(0, 50) + "..." : "NO URL",
        urlLength: req.body.logo.url ? req.body.logo.url.length : 0,
      });
    } else {
      console.log("[ProjectUpdate] No logo in request body. Keys:", Object.keys(req.body || {}));
    }

    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error("[ProjectUpdate] Schema validation failed:", JSON.stringify(parsed.error.errors, null, 2));
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const patch = { ...parsed.data };

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    // Upload Logo to S3 if update includes new base64 logo
    if (patch.logo?.url && patch.logo.url.startsWith("data:")) {
      console.log("[ProjectUpdate] Uploading logo to S3...", { fileName: patch.logo.fileName });
      try {
        const { buffer, mimeType } = base64ToBuffer(patch.logo.url);
        const s3Url = await uploadToS3(buffer, patch.logo.fileName || "logo", mimeType, "projects/logos");
        console.log("[ProjectUpdate] S3 upload SUCCESS:", s3Url);
        patch.logo.url = s3Url;
      } catch (err) {
        console.error("[ProjectUpdate] S3 upload FAILED:", err.message || err);
        // Keep the base64 data URL in MongoDB as fallback
      }
    } else if (patch.logo) {
      console.log("[ProjectUpdate] Logo present but no base64 data URL. url starts with:", patch.logo.url?.substring(0, 30));
    }

    // Upload Project Attachments to S3 for updates
    if (Array.isArray(patch.attachments) && patch.attachments.length > 0) {
      patch.attachments = await Promise.all(patch.attachments.map(async (att) => {
        if (att.url && att.url.startsWith("data:")) {
          try {
            const { buffer, mimeType } = base64ToBuffer(att.url);
            const s3Url = await uploadToS3(buffer, att.fileName || "attachment", mimeType, "projects/attachments");
            return { ...att, url: s3Url, uploadedAt: att.uploadedAt || new Date() };
          } catch (err) {
            console.error("Failed to upload updated project attachment to S3:", err);
            return att;
          }
        }
        return att;
      }));
    }

    // Update fields using findByIdAndUpdate
    console.log("[ProjectUpdate] Saving to MongoDB. Patch keys:", Object.keys(patch), patch.logo ? { logoUrl: patch.logo.url?.substring(0, 60) } : "no logo in patch");
    const updated = await Project.findByIdAndUpdate(
      req.params.id,
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    console.log("[ProjectUpdate] Saved. DB logo URL:", updated.logo?.url?.substring(0, 80));

    void cacheDel(`project:${req.params.id}`);

    await logActivity(
      req,
      "PROJECT_UPDATE",
      "project",
      updated._id,
      updated.name,
      `Updated project: ${updated.name}`
    );

    if (patch.description) {
      const mentionedUsers = await extractMentions(patch.description);
      if (mentionedUsers.length > 0) {
        await createNotification({
          actor: String(req.user?.name || req.user?.username || "System"),
          actorRole: String(req.user?.role || ""),
          action: "mentioned you in project",
          resourceType: "project",
          resourceName: updated.name,
          assignees: mentionedUsers,
          details: `"${patch.description.length > 50 ? patch.description.substring(0, 50) + "..." : patch.description}"`,
          resourceId: String(updated._id),
          category: "MENTIONED",
        });
      }
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    console.error("Project Update Error:", err);
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
      actor: req.user?.name || req.user?.username || "System",
      actorRole: req.user?.role || "",
      action: "reassigned",
      resourceType: "project",
      resourceName: project.name,
      assignees,
      resourceId: String(req.params.id),
      category: "PROJECT_ASSIGNED",
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
        dropboxAttachments: project.dropboxAttachments,
        createdAt: project.createdAt,
        createdByUserId: project.createdByUserId,
        createdByUsername: project.createdByUsername,
        createdByRole: project.createdByRole,
      },
      parentType: "standalone",
      parentId: String(project._id),
      parentName: project.name,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.name || req.user?.username || ""),
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

    return res.json({ success: true, message: "Project archived successfully" });
  } catch (err) {
    return next(err);
  }
});


router.get("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).lean();
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    const items = await ProjectComment.find({ projectId: project._id }).sort({ createdAt: 1 }).lean();

    const userIds = [...new Set(items.map(c => c.authorUserId))].filter(Boolean);
    const settingsList = await Settings.find({ userId: { $in: userIds } }).lean();
    
    const settingsMap = {};
    settingsList.forEach(s => {
      settingsMap[s.userId] = {
        fullName: s.fullName || "",
        avatar: s.avatarDataUrl || s.avatarUrl || ""
      };
    });

    return res.json({
      items: items.map((c) => ({
        id: String(c._id),
        projectId: String(c.projectId),
        message: String(c.message || ""),
        authorUserId: String(c.authorUserId || ""),
        authorUsername: String(c.authorUsername || ""),
        authorFullName: (c.authorUserId && settingsMap[c.authorUserId]?.fullName) || "",
        authorAvatar: (c.authorUserId && settingsMap[c.authorUserId]?.avatar) || "",
        authorRole: String(c.authorRole || ""),
        attachments: Array.isArray(c.attachments) ? c.attachments.map(a => ({
          fileName: a.fileName || "",
          mimeType: a.mimeType || "",
          size: a.size || 0,
          uploadedAt: a.uploadedAt,
          url: a.url
        })) : [],
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id).lean();
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    const message = String(req.body?.message || "").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    
    if (!message && attachments.length === 0) {
      return res.status(400).json({ error: { message: "Message or attachment is required" } });
    }

    const created = await ProjectComment.create({
      projectId: project._id,
      authorUserId: String(req.user?.sub || req.user?.id || ""),
      authorUsername: String(req.user?.username || ""),
      authorRole: String(req.user?.role || ""),
      message,
      attachments
    });

    await logActivity(req, "PROJECT_COMMENT_CREATE", "project", project._id, project.name, `Comment added on project: ${project.name}`);

    // Process Mentions
    const mentionedUsers = await extractMentions(message);
    if (mentionedUsers.length > 0) {
      await createNotification({
        actor: String(req.user?.name || req.user?.username || "Someone"),
        actorRole: String(req.user?.role || ""),
        action: "mentioned you in a",
        resourceType: "project comment",
        resourceName: project.name,
        assignees: mentionedUsers,
        details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
        resourceId: String(project._id),
        category: "MENTIONED",
      });
    }

    // Notify task assignees and creator about the new comment
    const commentRecipients = new Set([
      ...(Array.isArray(project.assignees) ? project.assignees : []),
      project.createdByUsername || ""
    ].filter(Boolean));
    if (commentRecipients.size > 0) {
      await createNotification({
        actor: String(req.user?.name || req.user?.username || "Someone"),
        actorRole: String(req.user?.role || ""),
        action: "commented on",
        resourceType: "project",
        resourceName: project.name,
        assignees: Array.from(commentRecipients),
        details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
        resourceId: String(project._id),
        category: "COMMENT_ADDED",
      });
    }

    const authorUserId = String(req.user?.sub || req.user?.id || "");
    const userSettings = await Settings.findOne({ userId: authorUserId }).lean();

    const commentData = {
      id: String(created._id),
      projectId: String(created.projectId),
      message: String(created.message || ""),
      authorUserId: authorUserId,
      authorUsername: String(created.authorUsername || ""),
      authorFullName: userSettings?.fullName || "",
      authorAvatar: userSettings?.avatarDataUrl || userSettings?.avatarUrl || "",
      authorRole: String(created.authorRole || ""),
      attachments: Array.isArray(created.attachments) ? created.attachments.map(a => ({
        fileName: a.fileName || "",
        mimeType: a.mimeType || "",
        size: a.size || 0,
        uploadedAt: a.uploadedAt,
        url: a.url
      })) : [],
      createdAt: created.createdAt,
    };
    
    if (global.io) {
      global.io.to(`project-${project._id}`).emit("new-project-comment", commentData);
    }

    return res.status(201).json({ item: commentData });
  } catch (err) {
    return next(err);
  }
});

// ============================================================================
// Execution Priority System - Admin Only (Project Tasks)
// ============================================================================

// DELETE /api/projects/:id/priorities - Clear all execution priorities for a project's tasks
router.delete("/:id/priorities", requireAuth, async (req, res, next) => {
  try {
    // Check admin role
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: { message: "Only admins can manage execution priorities" } });
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid project ID" } });
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ error: { message: "Project not found" } });
    }

    // Clear execution priorities for all tasks in this project
    const result = await Task.updateMany(
      { projectId: new mongoose.Types.ObjectId(id), executionPriority: { $ne: null } },
      { executionPriority: null }
    );

    // Log activity
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action: "cleared_project_execution_priorities",
      resourceType: "project",
      resourceId: String(project._id),
      resourceName: project.name,
      description: `Cleared all execution priorities for ${result.modifiedCount} tasks in project "${project.name}"`,
    });

    // Clear cache
    await cacheDel("tasks:*");
    await cacheDel("projects:*");

    return res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `All execution priorities cleared for ${result.modifiedCount} tasks in project "${project.name}"`,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
