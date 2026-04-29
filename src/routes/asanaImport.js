const express = require("express");
const { z } = require("zod");

const { requireAuth, requireRole, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");
const { importAsanaData } = require("../lib/asanaImportService");
const { createAsanaClient } = require("../lib/asanaClient");
const AsanaWorkspace = require("../models/AsanaWorkspace");
const AsanaProject = require("../models/AsanaProject");
const AsanaTask = require("../models/AsanaTask");
const AsanaComment = require("../models/AsanaComment");
const AsanaAttachment = require("../models/AsanaAttachment");
const AsanaUser = require("../models/AsanaUser");
const ImportJob = require("../models/ImportJob");

// Internal Task Manager Models
const Project = require("../models/Project");
const Task = require("../models/Task");
const TaskComment = require("../models/TaskComment");
const User = require("../models/User");

const router = express.Router();

function newJobId() {
  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const startSchema = z.object({
  token: z.string().min(1, "Asana token is required"),
  workspaceId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const testSchema = z.object({
  token: z.string().min(1, "Asana token is required"),
  workspaceId: z.string().optional(),
  clientSecret: z.string().optional(),
});

router.post("/start", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    // Token is used only in-memory for this request.
    const token = String(parsed.data.token || "").trim();
    const workspaceId = String(parsed.data.workspaceId || parsed.data.clientSecret || "").trim();
    if (!workspaceId) {
      return res.status(400).json({ error: { message: "Client Secret ID (Workspace ID) is required" } });
    }

    // Validate Asana token/workspace access early so we don't start a job that will fail.
    try {
      const client = createAsanaClient(token);
      await client.get("/users/me", { params: { opt_fields: "gid,name,email" } });
      await client.get(`/workspaces/${encodeURIComponent(workspaceId)}`, {
        params: { opt_fields: "gid,name" },
      });
    } catch (err) {
      const e = err;
      const status = Number(e?.response?.status || 500);
      const msgFromAsana = e?.response?.data?.errors?.[0]?.message;
      const message = String(msgFromAsana || e?.message || "Asana validation failed");
      if (status === 401 || status === 403) {
        return res.status(400).json({ error: { message } });
      }
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: { message } });
    }

    const jobId = newJobId();

    // Persist the job in MongoDB so polling always finds it
    await ImportJob.create({
      jobId,
      status: "running",
      stage: "queued",
      startedAt: new Date(),
      updatedAt: new Date(),
      error: null,
      result: null,
    });

    // Return jobId immediately — the import runs in the background.
    // On EC2 the Node process stays alive, so setImmediate works perfectly.
    // Progress is tracked in MongoDB so /status/:jobId always finds the job.
    res.json({ ok: true, jobId });

    // Run import in background (after response is sent)
    setImmediate(() => {
      console.log(`[ASANA-IMPORT] Background import started for job ${jobId}`);

      importAsanaData({
        token,
        workspaceId,
        onProgress: async ({ stage }) => {
          console.log(`[ASANA-IMPORT] Job ${jobId} progress: ${stage}`);
          try {
            await ImportJob.updateOne(
              { jobId },
              { $set: { stage: String(stage || ""), updatedAt: new Date() } }
            );
          } catch (err) {
            console.error(`[ASANA-IMPORT] Failed to update progress for ${jobId}:`, err.message);
          }
        },
      })
        .then(async (result) => {
          console.log(`[ASANA-IMPORT] Job ${jobId} completed successfully`);
          await ImportJob.updateOne(
            { jobId },
            {
              $set: {
                status: "completed",
                stage: "done",
                result,
                updatedAt: new Date(),
              },
            }
          );
        })
        .catch(async (e) => {
          console.error(`[ASANA-IMPORT] Job ${jobId} FAILED:`, e.message || e);
          await ImportJob.updateOne(
            { jobId },
            {
              $set: {
                status: "failed",
                error: e instanceof Error ? e.message : "Import failed",
                updatedAt: new Date(),
              },
            }
          ).catch((dbErr) => {
            console.error(`[ASANA-IMPORT] Failed to save error status for ${jobId}:`, dbErr.message);
          });
        });
    });

  } catch (err) {
    return next(err);
  }
});

router.get("/status/:jobId", requireAuth, requireAdmin, async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();

  // Look up the job from MongoDB instead of in-memory Map
  const job = await ImportJob.findOne({ jobId }).lean();
  if (!job) {
    return res.status(404).json({ error: { message: "Job not found" } });
  }

  return res.json({
    ok: true,
    job: {
      id: job.jobId,
      status: job.status,
      stage: job.stage,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      error: job.error,
      result: job.result,
    },
  });
});

router.post("/test", requireAuth, requireAdmin, async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { message: "Invalid payload" } });
  }

  const token = String(parsed.data.token || "").trim();
  const workspaceId = String(parsed.data.workspaceId || parsed.data.clientSecret || "").trim();

  try {
    const client = createAsanaClient(token);
    const meRes = await client.get("/users/me", { params: { opt_fields: "gid,name,email" } });

    let workspace = null;
    if (workspaceId) {
      const wsRes = await client.get(`/workspaces/${encodeURIComponent(workspaceId)}`, {
        params: { opt_fields: "gid,name" },
      });
      workspace = wsRes?.data?.data || null;
    }

    return res.json({ ok: true, user: meRes?.data?.data || null, workspace });
  } catch (err) {
    const e = err;
    const status = Number(e?.response?.status || 500);
    const msgFromAsana = e?.response?.data?.errors?.[0]?.message;
    const message = String(msgFromAsana || e?.message || "Test connection failed");
    // If Asana token/workspace access is invalid, don't return 401 to the frontend.
    // A 401 response triggers admin UI auto-logout (used for app auth), but this is an external API error.
    if (status === 401 || status === 403) {
      return res.status(400).json({ error: { message } });
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: { message } });
  }
});

router.get("/workspaces", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const items = await AsanaWorkspace.find({}).sort({ name: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get("/projects", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const workspaceAsanaId = String(req.query.workspaceAsanaId || "").trim();
    if (!workspaceAsanaId) {
      return res.status(400).json({ error: { message: "workspaceAsanaId is required" } });
    }

    const projects = await AsanaProject.find({ workspaceAsanaId }).sort({ name: 1 }).lean();
    const projectIds = projects.map((p) => String(p.asanaId));
    const counts = projectIds.length
      ? await AsanaTask.aggregate([
          { $match: { projectAsanaId: { $in: projectIds }, parentAsanaId: "" } },
          { $group: { _id: "$projectAsanaId", count: { $sum: 1 } } },
        ])
      : [];
    const map = new Map(counts.map((c) => [String(c._id), Number(c.count || 0)]));

    const items = projects.map((p) => ({ ...p, tasksCount: map.get(String(p.asanaId)) || 0 }));
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get("/tasks", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const projectAsanaId = String(req.query.projectAsanaId || "").trim();
    if (!projectAsanaId) {
      return res.status(400).json({ error: { message: "projectAsanaId is required" } });
    }

    const items = await AsanaTask.find({ projectAsanaId, parentAsanaId: "" })
      .sort({ completed: 1, dueDate: 1, title: 1 })
      .lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get("/task/:asanaId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const asanaId = String(req.params.asanaId || "").trim();
    const task = await AsanaTask.findOne({ asanaId }).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    const subtasks = await AsanaTask.find({ parentAsanaId: asanaId }).sort({ completed: 1, dueDate: 1, title: 1 }).lean();
    return res.json({ ok: true, task, subtasks });
  } catch (err) {
    return next(err);
  }
});

router.get("/task/:asanaId/comments", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const asanaId = String(req.params.asanaId || "").trim();
    const items = await AsanaComment.find({ taskAsanaId: asanaId }).sort({ createdAtAsana: 1 }).lean();
    
    // Resolve author names from AsanaUser collection
    const authorIds = [...new Set(items.map(c => c.authorAsanaId).filter(Boolean))];
    const users = authorIds.length > 0 
      ? await AsanaUser.find({ asanaId: { $in: authorIds } }).lean() 
      : [];
    const userMap = new Map(users.map(u => [u.asanaId, u]));
    
    const enriched = items.map(c => ({
      ...c,
      authorName: userMap.get(c.authorAsanaId)?.name || "",
      authorEmail: userMap.get(c.authorAsanaId)?.email || "",
    }));
    
    return res.json({ ok: true, items: enriched });
  } catch (err) {
    return next(err);
  }
});

router.get("/task/:asanaId/attachments", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const asanaId = String(req.params.asanaId || "").trim();
    const items = await AsanaAttachment.find({ taskAsanaId: asanaId }).sort({ fileName: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

// Get all imported Asana users
router.get("/users", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const items = await AsanaUser.find({}).sort({ name: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

// Transfer Asana Project to Internal Task Manager
router.post("/transfer-project", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { projectAsanaId } = req.body;
    if (!projectAsanaId) {
      return res.status(400).json({ error: { message: "projectAsanaId is required" } });
    }

    // 1. Fetch Asana Project
    const asanaProject = await AsanaProject.findOne({ asanaId: projectAsanaId }).lean();
    if (!asanaProject) {
      return res.status(404).json({ error: { message: "Asana project not found" } });
    }

    // 2. Fetch all Asana Tasks for this project
    const asanaTasks = await AsanaTask.find({ projectAsanaId }).lean();
    
    // 3. Prep User Mapping (Asana Email -> Internal User)
    const asanaUsers = await AsanaUser.find({}).lean();
    const internalUsers = await User.find({}).lean();
    const emailToInternalUser = new Map(internalUsers.map(u => [u.email.toLowerCase(), u]));
    
    const asanaIdToInternalUser = new Map();
    for (const au of asanaUsers) {
      const internal = emailToInternalUser.get(au.email.toLowerCase());
      if (internal) asanaIdToInternalUser.set(au.asanaId, internal);
    }

    // 4. Create Internal Project
    const newProject = await Project.create({
      name: asanaProject.name,
      description: `Imported from Asana (ID: ${asanaProject.asanaId})`,
      createdByUserId: req.user?._id || "",
      createdByUsername: req.user?.username || "",
      createdByRole: req.user?.role || "admin",
      status: "Active"
    });

    let tasksCreated = 0;
    let commentsCreated = 0;

    // 5. Create Tasks and Subtasks
    // To handle subtasks, we might need a mapping of Asana ID to Internal ID
    const asanaIdToInternalTaskId = new Map();

    // Process top-level tasks first
    for (const at of asanaTasks.filter(t => !t.parentAsanaId)) {
      const internalTask = await Task.create({
        title: at.title,
        description: at.description,
        projectId: newProject._id,
        status: at.completed ? "completed" : "pending",
        dueDate: at.dueDate ? new Date(at.dueDate) : undefined,
        createdBy: {
          userId: req.user?._id || "",
          name: req.user?.name || req.user?.username || "",
          email: req.user?.email || "",
          role: req.user?.role || "admin"
        }
      });
      asanaIdToInternalTaskId.set(at.asanaId, internalTask._id);
      tasksCreated++;

      // Transfer Comments for this task
      const asanaComments = await AsanaComment.find({ taskAsanaId: at.asanaId }).sort({ createdAtAsana: 1 }).lean();
      for (const ac of asanaComments) {
        const author = asanaIdToInternalUser.get(ac.authorAsanaId);
        await TaskComment.create({
          taskId: internalTask._id,
          authorUserId: author?._id || "",
          authorUsername: author?.name || author?.username || ac.authorName || "Asana User",
          authorRole: author?.role || "",
          message: ac.message,
          createdAt: ac.createdAtAsana ? new Date(ac.createdAtAsana) : undefined
        });
        commentsCreated++;
      }

      // Transfer Attachments
      const asanaAtts = await AsanaAttachment.find({ taskAsanaId: at.asanaId }).lean();
      if (asanaAtts.length > 0) {
        internalTask.attachments = asanaAtts.map(a => ({
          fileName: a.fileName,
          url: a.filePath,
          mimeType: a.mimeType,
          size: a.size,
          uploadedAt: new Date()
        }));
        await internalTask.save();
      }
    }

    // Process subtasks (at most one level deep supported for simplicity in this carbon-copy)
    for (const st of asanaTasks.filter(t => t.parentAsanaId)) {
      const parentId = asanaIdToInternalTaskId.get(st.parentAsanaId);
      const internalSubtask = await Task.create({
        title: `[Subtask] ${st.title}`,
        description: st.description,
        projectId: newProject._id,
        // Optional: link to parent if your Task model supports it, 
        // but often we just list them under the same project.
        status: st.completed ? "completed" : "pending",
        dueDate: st.dueDate ? new Date(st.dueDate) : undefined,
        createdBy: {
          userId: req.user?._id || "",
          name: req.user?.name || req.user?.username || "",
          email: req.user?.email || "",
          role: req.user?.role || "admin"
        }
      });
      tasksCreated++;

      // Comments for subtask
      const asanaComments = await AsanaComment.find({ taskAsanaId: st.asanaId }).sort({ createdAtAsana: 1 }).lean();
      for (const ac of asanaComments) {
        const author = asanaIdToInternalUser.get(ac.authorAsanaId);
        await TaskComment.create({
          taskId: internalSubtask._id,
          authorUserId: author?._id || "",
          authorUsername: author?.name || author?.username || ac.authorName || "Asana User",
          authorRole: author?.role || "",
          message: ac.message,
          createdAt: ac.createdAtAsana ? new Date(ac.createdAtAsana) : undefined
        });
        commentsCreated++;
      }

      // Attachments for subtask
      const asanaAtts = await AsanaAttachment.find({ taskAsanaId: st.asanaId }).lean();
      if (asanaAtts.length > 0) {
        internalSubtask.attachments = asanaAtts.map(a => ({
          fileName: a.fileName,
          url: a.filePath,
          mimeType: a.mimeType,
          size: a.size,
          uploadedAt: new Date()
        }));
        await internalSubtask.save();
      }
    }

    return res.json({ 
      ok: true, 
      message: "Project successfully transferred to Task Manager",
      projectId: newProject._id,
      stats: {
        tasks: tasksCreated,
        comments: commentsCreated
      }
    });

  } catch (err) {
    next(err);
  }
});

// Clear all imported Asana data so user can do a fresh re-import
router.delete("/clear", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const fs = require("fs");
    const path = require("path");

    // Count before deleting
    const counts = {
      workspaces: await AsanaWorkspace.countDocuments(),
      projects: await AsanaProject.countDocuments(),
      tasks: await AsanaTask.countDocuments(),
      comments: await AsanaComment.countDocuments(),
      attachments: await AsanaAttachment.countDocuments(),
      users: await AsanaUser.countDocuments(),
      jobs: await ImportJob.countDocuments(),
    };

    // Get all attachment file paths before deleting records
    const allAttachments = await AsanaAttachment.find({}, { filePath: 1 }).lean();
    
    // Delete all Asana data from DB
    await Promise.all([
      AsanaWorkspace.deleteMany({}),
      AsanaProject.deleteMany({}),
      AsanaTask.deleteMany({}),
      AsanaComment.deleteMany({}),
      AsanaAttachment.deleteMany({}),
      AsanaUser.deleteMany({}),
      ImportJob.deleteMany({}),
    ]);

    // Try to delete downloaded files from disk
    let filesDeleted = 0;
    const baseUploads = path.resolve(__dirname, "..", "..", "uploads");
    for (const att of allAttachments) {
      if (!att.filePath) continue;
      try {
        // filePath is like /uploads/images/1234_file.pdf
        const relativePath = att.filePath.replace(/^\/uploads\//, "");
        const absPath = path.join(baseUploads, relativePath);
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
          filesDeleted++;
        }
      } catch {
        // ignore individual file delete errors
      }
    }

    return res.json({
      ok: true,
      message: "All Asana imported data has been cleared. You can now run a fresh import.",
      deleted: counts,
      filesDeleted,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
