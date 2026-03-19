const express = require("express");
const { z } = require("zod");

const { requireAuth, requireRole } = require("../middleware/auth");
const { importAsanaData } = require("../lib/asanaImportService");
const { createAsanaClient } = require("../lib/asanaClient");
const AsanaWorkspace = require("../models/AsanaWorkspace");
const AsanaProject = require("../models/AsanaProject");
const AsanaTask = require("../models/AsanaTask");
const AsanaComment = require("../models/AsanaComment");
const AsanaAttachment = require("../models/AsanaAttachment");
const ImportJob = require("../models/ImportJob");

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

router.post("/start", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
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
    setImmediate(async () => {
      try {
        const result = await importAsanaData({
          token,
          workspaceId,
          onProgress: async ({ stage }) => {
            try {
              await ImportJob.updateOne(
                { jobId },
                { $set: { stage: String(stage || ""), updatedAt: new Date() } }
              );
            } catch {
              // ignore progress-update failures
            }
          },
        });

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
      } catch (e) {
        await ImportJob.updateOne(
          { jobId },
          {
            $set: {
              status: "failed",
              error: e instanceof Error ? e.message : "Import failed",
              updatedAt: new Date(),
            },
          }
        ).catch(() => {});
      }
    });

  } catch (err) {
    return next(err);
  }
});

router.get("/status/:jobId", requireAuth, requireRole(["admin", "super-admin"]), async (req, res) => {
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

router.post("/test", requireAuth, requireRole(["admin", "super-admin"]), async (req, res) => {
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

router.get("/workspaces", requireAuth, requireRole(["admin", "super-admin"]), async (_req, res, next) => {
  try {
    const items = await AsanaWorkspace.find({}).sort({ name: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get("/projects", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
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

router.get("/tasks", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
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

router.get("/task/:asanaId", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
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

router.get("/task/:asanaId/comments", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
  try {
    const asanaId = String(req.params.asanaId || "").trim();
    const items = await AsanaComment.find({ taskAsanaId: asanaId }).sort({ createdAtAsana: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

router.get("/task/:asanaId/attachments", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
  try {
    const asanaId = String(req.params.asanaId || "").trim();
    const items = await AsanaAttachment.find({ taskAsanaId: asanaId }).sort({ fileName: 1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
