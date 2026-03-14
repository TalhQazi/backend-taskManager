const express = require("express");
const { z } = require("zod");

const { requireAuth, requireRole } = require("../middleware/auth");
const { importAsanaData } = require("../lib/asanaImportService");
const AsanaWorkspace = require("../models/AsanaWorkspace");
const AsanaProject = require("../models/AsanaProject");
const AsanaTask = require("../models/AsanaTask");
const AsanaComment = require("../models/AsanaComment");
const AsanaAttachment = require("../models/AsanaAttachment");

const router = express.Router();

const jobs = new Map();

function newJobId() {
  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const startSchema = z.object({
  token: z.string().min(1, "Asana token is required"),
  workspaceId: z.string().min(1, "Workspace ID is required"),
});

router.post("/start", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    // Token is used only in-memory for this request.
    const { token, workspaceId } = parsed.data;

    const jobId = newJobId();
    const job = {
      id: jobId,
      status: "running",
      stage: "queued",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      result: null,
    };
    jobs.set(jobId, job);

    setImmediate(async () => {
      try {
        const result = await importAsanaData({
          token,
          workspaceId,
          onProgress: ({ stage }) => {
            const j = jobs.get(jobId);
            if (!j) return;
            j.stage = String(stage || "");
            j.updatedAt = new Date().toISOString();
          },
        });

        const j = jobs.get(jobId);
        if (!j) return;
        j.status = "completed";
        j.stage = "done";
        j.result = result;
        j.updatedAt = new Date().toISOString();
      } catch (e) {
        const j = jobs.get(jobId);
        if (!j) return;
        j.status = "failed";
        j.error = e instanceof Error ? e.message : "Import failed";
        j.updatedAt = new Date().toISOString();
      }
    });

    return res.json({ ok: true, jobId });
  } catch (err) {
    return next(err);
  }
});

router.get("/status/:jobId", requireAuth, requireRole(["admin", "super-admin"]), async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: { message: "Job not found" } });
  }
  return res.json({ ok: true, job });
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
