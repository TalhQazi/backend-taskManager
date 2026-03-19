const fs = require("fs");
const path = require("path");

const AsanaUser = require("../models/AsanaUser");
const AsanaWorkspace = require("../models/AsanaWorkspace");
const AsanaProject = require("../models/AsanaProject");
const AsanaTask = require("../models/AsanaTask");
const AsanaComment = require("../models/AsanaComment");
const AsanaAttachment = require("../models/AsanaAttachment");

const { createAsanaClient, fetchAllPaginated, sleep } = require("./asanaClient");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeFileName(name) {
  const v = String(name || "file");
  return v.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
}

function pickUploadDir(originalName, mimeType) {
  const n = String(originalName || "").toLowerCase();
  const m = String(mimeType || "").toLowerCase();

  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return "images";
  if (m.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm)$/.test(n)) return "videos";
  if (m === "application/pdf" || /\.pdf$/.test(n)) return "pdfs";
  return "files";
}

async function importAsanaData({ token, workspaceId, onProgress }) {
  const progress = (stage, meta) => {
    try {
      onProgress?.({ stage, ...meta });
    } catch {
      // ignore
    }
  };

  const client = createAsanaClient(token);

  progress("users_fetch_start");
  const users = await fetchAllPaginated(
    client,
    "/users",
    { workspace: workspaceId, opt_fields: "gid,name,email" },
    { delayMs: 600, pageSize: 100 }
  );
  progress("users_fetch_done", { count: users.length });
  await sleep(1000); // 1 second delay between phases

  progress("users_save_start");
  for (const u of users) {
    await AsanaUser.findOneAndUpdate(
      { asanaId: String(u.gid) },
      { $set: { asanaId: String(u.gid), name: String(u.name || ""), email: String(u.email || "") } },
      { upsert: true, new: true }
    );
  }
  progress("users_save_done");
  await sleep(1000); // Delay before next phase

  progress("workspaces_fetch_start");
  const workspaces = await fetchAllPaginated(
    client,
    "/workspaces",
    { opt_fields: "gid,name" },
    { delayMs: 600, pageSize: 100 }
  );
  progress("workspaces_fetch_done", { count: workspaces.length });
  await sleep(1000);

  progress("workspaces_save_start");
  for (const w of workspaces) {
    await AsanaWorkspace.findOneAndUpdate(
      { asanaId: String(w.gid) },
      { $set: { asanaId: String(w.gid), name: String(w.name || "") } },
      { upsert: true, new: true }
    );
  }
  progress("workspaces_save_done");
  await sleep(1000);

  progress("projects_fetch_start");
  const projects = await fetchAllPaginated(
    client,
    "/projects",
    { workspace: workspaceId, opt_fields: "gid,name,created_at" },
    { delayMs: 600, pageSize: 100 }
  );
  progress("projects_fetch_done", { count: projects.length });
  await sleep(1000);

  progress("projects_save_start");
  for (const p of projects) {
    await AsanaProject.findOneAndUpdate(
      { asanaId: String(p.gid) },
      {
        $set: {
          asanaId: String(p.gid),
          workspaceAsanaId: String(workspaceId),
          name: String(p.name || ""),
          createdAtAsana: String(p.created_at || ""),
        },
      },
      { upsert: true, new: true }
    );
  }
  progress("projects_save_done");
  await sleep(1000);

  progress("tasks_fetch_start");
  const tasks = [];
  for (const p of projects) {
    const projectId = String(p.gid);
    const projectTasks = await fetchAllPaginated(
      client,
      "/tasks",
      {
        project: projectId,
        opt_fields: "gid,name,notes,due_on,completed,parent.gid",
      },
      { delayMs: 600, pageSize: 100 }
    );
    tasks.push(...projectTasks.map((t) => ({ ...t, __projectGid: projectId })));
    await sleep(600); // 600ms delay between each project
  }
  progress("tasks_fetch_done", { count: tasks.length });
  await sleep(1000);

  progress("tasks_save_start");
  for (const t of tasks) {
    await AsanaTask.findOneAndUpdate(
      { asanaId: String(t.gid) },
      {
        $set: {
          asanaId: String(t.gid),
          projectAsanaId: String(t.__projectGid || ""),
          parentAsanaId: String(t.parent?.gid || ""),
          title: String(t.name || ""),
          description: String(t.notes || ""),
          dueDate: String(t.due_on || ""),
          completed: !!t.completed,
        },
      },
      { upsert: true, new: true }
    );
  }
  progress("tasks_save_done");
  await sleep(1000);

  // subtasks are included via parent.gid, but Asana also has explicit endpoint.
  // We'll fetch subtasks per task to satisfy the required sequence.
  progress("subtasks_fetch_start");
  const subtasks = [];
  for (const t of tasks) {
    const taskId = String(t.gid);
    const st = await fetchAllPaginated(
      client,
      `/tasks/${encodeURIComponent(taskId)}/subtasks`,
      { opt_fields: "gid,name,notes,due_on,completed,parent.gid" },
      { delayMs: 600, pageSize: 100 }
    );
    subtasks.push(...st.map((s) => ({ ...s, __parentGid: taskId })));
    await sleep(600); // Sequential: one task at a time
  }
  progress("subtasks_fetch_done", { count: subtasks.length });
  await sleep(1000);

  progress("subtasks_save_start");
  for (const s of subtasks) {
    await AsanaTask.findOneAndUpdate(
      { asanaId: String(s.gid) },
      {
        $set: {
          asanaId: String(s.gid),
          projectAsanaId: "",
          parentAsanaId: String(s.__parentGid || s.parent?.gid || ""),
          title: String(s.name || ""),
          description: String(s.notes || ""),
          dueDate: String(s.due_on || ""),
          completed: !!s.completed,
        },
      },
      { upsert: true, new: true }
    );
  }
  progress("subtasks_save_done");
  await sleep(1000);

  progress("comments_fetch_start");
  const comments = [];
  for (const t of tasks) {
    const taskId = String(t.gid);
    const stories = await fetchAllPaginated(
      client,
      `/tasks/${encodeURIComponent(taskId)}/stories`,
      { opt_fields: "gid,type,text,created_at,created_by.gid" },
      { delayMs: 600, pageSize: 100 }
    );
    for (const s of stories) {
      if (String(s.type) !== "comment") continue;
      comments.push({ ...s, __taskGid: taskId });
    }
    await sleep(600); // Sequential: one task at a time
  }
  progress("comments_fetch_done", { count: comments.length });
  await sleep(1000);

  progress("comments_save_start");
  for (const c of comments) {
    await AsanaComment.findOneAndUpdate(
      { asanaId: String(c.gid) },
      {
        $set: {
          asanaId: String(c.gid),
          taskAsanaId: String(c.__taskGid),
          authorAsanaId: String(c.created_by?.gid || ""),
          message: String(c.text || ""),
          createdAtAsana: String(c.created_at || ""),
        },
      },
      { upsert: true, new: true }
    );
  }
  progress("comments_save_done");
  await sleep(1000);

  progress("attachments_fetch_start");
  const attachments = [];
  for (const t of tasks) {
    const taskId = String(t.gid);
    const atts = await fetchAllPaginated(
      client,
      `/tasks/${encodeURIComponent(taskId)}/attachments`,
      { opt_fields: "gid,name,download_url,permanent_url,host,size" },
      { delayMs: 600, pageSize: 100 }
    );
    attachments.push(...atts.map((a) => ({ ...a, __taskGid: taskId })));
    await sleep(600); // Sequential: one task at a time
  }
  progress("attachments_fetch_done", { count: attachments.length });
  await sleep(1000);

  const baseUploads = path.resolve(__dirname, "..", "..", "uploads");

  progress("attachments_download_start");
  let downloaded = 0;

  // Download attachments SEQUENTIALLY (one at a time) - no concurrency
  for (const a of attachments) {
    const asanaId = String(a.gid);

    const exists = await AsanaAttachment.findOne({ asanaId }).lean();
    if (exists?.filePath) {
      continue;
    }

    const downloadUrl = String(a.download_url || "");
    if (!downloadUrl) {
      await AsanaAttachment.findOneAndUpdate(
        { asanaId },
        {
          $set: {
            asanaId,
            taskAsanaId: String(a.__taskGid),
            fileName: String(a.name || ""),
            filePath: "",
            mimeType: "",
            size: Number(a.size || 0) || 0,
          },
        },
        { upsert: true, new: true }
      );
      continue;
    }

    const fileName = safeFileName(a.name || `${asanaId}`);

    try {
      // NOTE: Asana download_url is short-lived; we must download immediately.
      const response = await client.get(downloadUrl, { responseType: "arraybuffer" });
      const mimeType = String(response.headers?.["content-type"] || "");
      const size = Number(response.headers?.["content-length"] || 0) || Number(a.size || 0) || 0;

      const dirName = pickUploadDir(fileName, mimeType);
      const dir = path.join(baseUploads, dirName);
      ensureDir(dir);

      const filePathAbs = path.join(dir, `${Date.now()}_${fileName}`);
      fs.writeFileSync(filePathAbs, Buffer.from(response.data));

      // store relative path so it can be served under /uploads
      const relative = path.relative(baseUploads, filePathAbs).split(path.sep).join("/");

      await AsanaAttachment.findOneAndUpdate(
        { asanaId },
        {
          $set: {
            asanaId,
            taskAsanaId: String(a.__taskGid),
            fileName,
            filePath: `/uploads/${relative}`,
            mimeType,
            size,
          },
        },
        { upsert: true, new: true }
      );

      downloaded += 1;
      if (downloaded % 5 === 0) {
        progress("attachments_download_progress", { downloaded });
      }
    } catch (err) {
      // Skip failed downloads, log but continue
      console.error(`Failed to download attachment ${asanaId}:`, err.message);
    }

    // 600ms delay between each download - SEQUENTIAL
    await sleep(600);
  }

  progress("attachments_download_done", { downloaded });

  return {
    ok: true,
    imported: {
      users: users.length,
      workspaces: workspaces.length,
      projects: projects.length,
      tasks: tasks.length,
      subtasks: subtasks.length,
      comments: comments.length,
      attachments: attachments.length,
      downloadedAttachments: downloaded,
    },
  };
}

module.exports = { importAsanaData };
