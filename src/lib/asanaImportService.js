const fs = require("fs");
const path = require("path");
const axios = require("axios");

const AsanaUser = require("../models/AsanaUser");
const AsanaWorkspace = require("../models/AsanaWorkspace");
const AsanaProject = require("../models/AsanaProject");
const AsanaTask = require("../models/AsanaTask");
const AsanaComment = require("../models/AsanaComment");
const AsanaAttachment = require("../models/AsanaAttachment");

const { createAsanaClient, fetchAllPaginated, sleep } = require("./asanaClient");
const { uploadToS3 } = require("./s3");

function safeFileName(name) {
  const v = String(name || "file");
  return v.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
}

function guessMimeType(fileName, headerMime) {
  // If the header already has a reasonable value, use it
  if (headerMime && !headerMime.includes("octet-stream") && !headerMime.includes("html")) {
    return headerMime;
  }
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", rar: "application/x-rar-compressed",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav",
    txt: "text/plain", csv: "text/csv", json: "application/json",
  };
  return map[ext] || headerMime || "application/octet-stream";
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
  await sleep(200);

  progress("users_save_start");
  for (const u of users) {
    const asanaId = String(u.gid);
    const exists = await AsanaUser.exists({ asanaId });
    if (!exists) {
      await AsanaUser.create({
        asanaId,
        name: String(u.name || ""),
        email: String(u.email || ""),
      });
    }
  }
  progress("users_save_done");
  await sleep(200);

  progress("workspaces_fetch_start");
  const workspaces = await fetchAllPaginated(
    client,
    "/workspaces",
    { opt_fields: "gid,name" },
    { delayMs: 600, pageSize: 100 }
  );
  progress("workspaces_fetch_done", { count: workspaces.length });
  await sleep(200);

  progress("workspaces_save_start");
  for (const w of workspaces) {
    const asanaId = String(w.gid);
    const exists = await AsanaWorkspace.exists({ asanaId });
    if (!exists) {
      await AsanaWorkspace.create({
        asanaId,
        name: String(w.name || ""),
      });
    }
  }
  progress("workspaces_save_done");
  await sleep(200);

  progress("projects_fetch_start");
  const projects = await fetchAllPaginated(
    client,
    "/projects",
    { workspace: workspaceId, opt_fields: "gid,name,created_at" },
    { delayMs: 600, pageSize: 100 }
  );
  progress("projects_fetch_done", { count: projects.length });
  await sleep(200);

  progress("projects_save_start");
  for (const p of projects) {
    const asanaId = String(p.gid);
    const exists = await AsanaProject.exists({ asanaId });
    if (!exists) {
      await AsanaProject.create({
        asanaId,
        workspaceAsanaId: String(workspaceId),
        name: String(p.name || ""),
        createdAtAsana: String(p.created_at || ""),
      });
    }
  }
  progress("projects_save_done");
  await sleep(200);

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
    await sleep(600);
  }
  progress("tasks_fetch_done", { count: tasks.length });
  await sleep(200);

  progress("tasks_save_start");
  for (const t of tasks) {
    const asanaId = String(t.gid);
    const exists = await AsanaTask.exists({ asanaId });
    if (!exists) {
      await AsanaTask.create({
        asanaId,
        projectAsanaId: String(t.__projectGid || ""),
        parentAsanaId: String(t.parent?.gid || ""),
        title: String(t.name || ""),
        description: String(t.notes || ""),
        dueDate: String(t.due_on || ""),
        completed: !!t.completed,
      });
    }
  }
  progress("tasks_save_done");
  await sleep(200);

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
    await sleep(600);
  }
  progress("subtasks_fetch_done", { count: subtasks.length });
  await sleep(200);

  progress("subtasks_save_start");
  for (const s of subtasks) {
    const asanaId = String(s.gid);
    const exists = await AsanaTask.exists({ asanaId });
    if (!exists) {
      await AsanaTask.create({
        asanaId,
        projectAsanaId: "",
        parentAsanaId: String(s.__parentGid || s.parent?.gid || ""),
        title: String(s.name || ""),
        description: String(s.notes || ""),
        dueDate: String(s.due_on || ""),
        completed: !!s.completed,
      });
    }
  }
  progress("subtasks_save_done");
  await sleep(200);

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
    await sleep(600);
  }
  progress("comments_fetch_done", { count: comments.length });
  await sleep(200);

  progress("comments_save_start");
  for (const c of comments) {
    const asanaId = String(c.gid);
    const exists = await AsanaComment.exists({ asanaId });
    if (!exists) {
      await AsanaComment.create({
        asanaId,
        taskAsanaId: String(c.__taskGid),
        authorAsanaId: String(c.created_by?.gid || ""),
        message: String(c.text || ""),
        createdAtAsana: String(c.created_at || ""),
      });
    }
  }
  progress("comments_save_done");
  await sleep(200);

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
    await sleep(600);
  }
  progress("attachments_fetch_done", { count: attachments.length });
  await sleep(200);

  // Check if S3 is configured
  const hasS3 = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && (process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET));

  progress("attachments_download_start");
  let downloaded = 0;

  for (const a of attachments) {
    const asanaId = String(a.gid);

    const exists = await AsanaAttachment.findOne({ asanaId }).lean();
    if (exists?.filePath) {
      // If already stored as S3 URL, skip
      if (exists.filePath.includes("amazonaws.com")) {
        continue;
      }
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
      // Download the file from Asana's download URL
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const headerMime = String(response.headers?.["content-type"] || "").split(";")[0].trim();
      const mimeType = guessMimeType(fileName, headerMime);
      const size = Number(response.headers?.["content-length"] || 0) || Number(a.size || 0) || 0;
      const buffer = Buffer.from(response.data);

      let storedUrl = "";

      if (hasS3) {
        // Upload to S3
        try {
          storedUrl = await uploadToS3(buffer, fileName, mimeType, "asana-imports");
          console.log(`[ASANA-IMPORT] Uploaded to S3: ${fileName} -> ${storedUrl}`);
        } catch (s3Err) {
          console.error(`[ASANA-IMPORT] S3 upload failed for ${fileName}:`, s3Err.message);
          storedUrl = "";
        }
      }

      // Fallback: save to local disk if S3 upload failed or is not configured
      if (!storedUrl) {
        const baseUploads = path.resolve(__dirname, "..", "..", "uploads");
        const dirName = mimeType.startsWith("image/") ? "images" : mimeType.startsWith("video/") ? "videos" : mimeType === "application/pdf" ? "pdfs" : "files";
        const dir = path.join(baseUploads, dirName);
        fs.mkdirSync(dir, { recursive: true });
        const filePathAbs = path.join(dir, `${Date.now()}_${fileName}`);
        fs.writeFileSync(filePathAbs, buffer);
        const relative = path.relative(baseUploads, filePathAbs).split(path.sep).join("/");
        storedUrl = `/uploads/${relative}`;
        console.log(`[ASANA-IMPORT] Saved to disk (S3 unavailable): ${fileName} -> ${storedUrl}`);
      }

      await AsanaAttachment.findOneAndUpdate(
        { asanaId },
        {
          $set: {
            asanaId,
            taskAsanaId: String(a.__taskGid),
            fileName,
            filePath: storedUrl,
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
      console.error(`Failed to download attachment ${asanaId}:`, err.message);
    }

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
