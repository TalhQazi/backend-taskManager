const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const BugReport = require("../models/BugReport");
const BugComment = require("../models/BugComment");
const BugAttachment = require("../models/BugAttachment");
const BugEvent = require("../models/BugEvent");
const BugParticipant = require("../models/BugParticipant");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

// Setup multer storage for uploaded bug attachments
const uploadDir = path.join(__dirname, "../../uploads/bugs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB max single file
});

function getUserId(req) {
  return String(req.user?.sub || req.user?.id || req.user?.userId || "").trim();
}

function getUserName(req) {
  return String(req.user?.username || req.user?.name || req.user?.email || "User").trim();
}

function getUserRole(req) {
  return String(req.user?.role || req.user?.userRole || "").toLowerCase().trim();
}

function withId(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.id = String(obj._id || obj.id || "");
  return obj;
}

// Helper to log bug audit trail events
async function logBugEvent(bugId, req, eventType, details, metadata = {}) {
  try {
    await BugEvent.create({
      bugId,
      actorId: getUserId(req),
      actorName: getUserName(req),
      actorRole: getUserRole(req),
      eventType,
      details,
      metadata,
    });
    await BugReport.findByIdAndUpdate(bugId, { lastActivity: new Date() });
  } catch (err) {
    console.error("[BugEvent] Failed to log event:", err);
  }
}

// ----------------------------------------------------
// ATTACHMENT & VIDEO UPLOAD ENGINE
// ----------------------------------------------------

function processUploadedFiles(files, req) {
  let combinedSize = 0;
  const processed = [];

  for (const file of files) {
    const mime = file.mimetype.toLowerCase();
    const size = file.size;
    combinedSize += size;

    const isImage = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(file.originalname);
    const isVideo = mime.startsWith("video/") || /\.(mp4|mov|webm|ogg|mkv)$/i.test(file.originalname);
    const isDoc = /\.(pdf|docx|xlsx)$/i.test(file.originalname) || mime.includes("pdf") || mime.includes("word") || mime.includes("spreadsheet");

    if (!isImage && !isVideo && !isDoc) {
      try { fs.unlinkSync(file.path); } catch {}
      const err = new Error(`File type not supported: ${file.originalname}`);
      err.status = 400;
      throw err;
    }

    if (isImage && size > 20 * 1024 * 1024) {
      try { fs.unlinkSync(file.path); } catch {}
      const err = new Error(`Image exceeds 20 MB limit: ${file.originalname}`);
      err.status = 400;
      throw err;
    }

    if (isVideo && size > 150 * 1024 * 1024) {
      try { fs.unlinkSync(file.path); } catch {}
      const err = new Error(`Video exceeds 150 MB limit: ${file.originalname}`);
      err.status = 400;
      throw err;
    }

    // Calculate file checksum
    const fileBuffer = fs.readFileSync(file.path);
    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const relativeUrl = `/uploads/bugs/${file.filename}`;

    processed.push({
      fileName: file.originalname,
      url: relativeUrl,
      mimeType: file.mimetype,
      size,
      duration: Number(req.body?.duration || 0),
      checksum,
      processingStatus: "completed",
    });
  }

  if (combinedSize > 250 * 1024 * 1024) {
    files.forEach(f => {
      try { fs.unlinkSync(f.path); } catch {}
    });
    const err = new Error("Combined file size exceeds 250 MB limit");
    err.status = 400;
    throw err;
  }

  return processed;
}

// Authenticated upload endpoint for internal Task Manager
router.post("/upload", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: { message: "No files provided" } });
    }
    const processed = processUploadedFiles(files, req);
    return res.status(201).json({ items: processed });
  } catch (err) {
    return res.status(err.status || 500).json({ error: { message: err.message || "Upload failed" } });
  }
});

// ----------------------------------------------------
// EXTERNAL BUG REPORTING APIs (Open to other websites)
// ----------------------------------------------------

// Public upload endpoint for external client websites
router.post("/external/upload", upload.array("files", 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: { message: "No files provided" } });
    }
    const processed = processUploadedFiles(files, req);
    return res.status(201).json({ items: processed });
  } catch (err) {
    return res.status(err.status || 500).json({ error: { message: err.message || "Upload failed" } });
  }
});

// Public status/info endpoint for external integrators
router.get("/external/info", (_req, res) => {
  res.json({
    status: "online",
    service: "Task Manager External Bug Ingestion API",
    version: "2.0",
    supportedOrigins: "*",
    endpoints: {
      postBug: "POST /api/bugs/external",
      uploadMedia: "POST /api/bugs/external/upload",
      widgetScript: "GET /api/bugs/external/widget.js",
    },
  });
});

// Embeddable JavaScript widget for external websites
router.get("/external/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  const protocol = req.protocol || "https";
  const host = req.get("host") || "task.se7eninc.com";
  const defaultApi = `${protocol}://${host}`;

  const js = `(function() {
  if (window.__TM_BUG_WIDGET_LOADED__) return;
  window.__TM_BUG_WIDGET_LOADED__ = true;

  var currentScript = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var apiBase = (currentScript && currentScript.getAttribute('data-api')) || '${defaultApi}';
  apiBase = apiBase.replace(/\\/+$/, '');
  var defaultWebsite = (currentScript && currentScript.getAttribute('data-website')) || document.title || window.location.hostname || 'External Website';
  var primaryColor = (currentScript && currentScript.getAttribute('data-color')) || '#0ea5e9';
  var position = (currentScript && currentScript.getAttribute('data-position')) || 'bottom-right';

  // Inject CSS animations
  var style = document.createElement('style');
  style.innerHTML = '@keyframes tmFadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }';
  document.head.appendChild(style);

  // Create floating trigger button
  var btn = document.createElement('button');
  btn.id = 'tm-bug-widget-trigger';
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg><span>Report Bug</span>';
  
  var btnStyle = 'position:fixed;z-index:999999;display:flex;align-items:center;justify-content:center;padding:10px 18px;background:' + primaryColor + ';color:#ffffff;border:none;border-radius:9999px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3),0 8px 10px -6px rgba(0,0,0,0.2);transition:all 0.2s ease;outline:none;';
  if (position === 'bottom-left') {
    btnStyle += 'bottom:20px;left:20px;';
  } else {
    btnStyle += 'bottom:20px;right:20px;';
  }
  btn.style.cssText = btnStyle;

  btn.onmouseover = function() { btn.style.transform = 'translateY(-2px) scale(1.02)'; };
  btn.onmouseout = function() { btn.style.transform = 'translateY(0) scale(1)'; };

  // Create Modal Overlay
  var overlay = document.createElement('div');
  overlay.id = 'tm-bug-widget-overlay';
  overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);z-index:1000000;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#ffffff;color:#0f172a;width:100%;max-width:520px;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);overflow:hidden;animation:tmFadeIn 0.2s ease-out;display:flex;flex-direction:column;max-height:90vh;box-sizing:border-box;';

  modal.innerHTML = ''
    + '<div style="padding:16px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">'
    + '  <div style="flex:1;">'
    + '    <div style="display:flex;align-items:center;gap:8px;">'
    + '      <span style="font-size:16px;font-weight:700;color:#0f172a;">Report an Issue</span>'
    + '      <span style="background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:600;padding:2px 8px;border-radius:9999px;">' + defaultWebsite + '</span>'
    + '    </div>'
    + '    <div style="font-size:11px;color:#64748b;margin-top:2px;">Help us resolve problems by sharing details of the issue.</div>'
    + '  </div>'
    + '  <button id="tm-bug-close-btn" type="button" style="background:transparent;border:none;cursor:pointer;padding:4px;color:#64748b;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;">&times;</button>'
    + '</div>'
    + '<form id="tm-bug-form" style="padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;margin:0;">'
    + '  <div id="tm-bug-msg" style="display:none;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:500;"></div>'
    + '  <div>'
    + '    <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Issue Title <span style="color:#ef4444;">*</span></label>'
    + '    <input type="text" id="tm-bug-title" required placeholder="e.g. Checkout button not responding" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;outline:none;" />'
    + '  </div>'
    + '  <div>'
    + '    <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Description & Steps to Reproduce <span style="color:#ef4444;">*</span></label>'
    + '    <textarea id="tm-bug-desc" required rows="3" placeholder="Explain what happened and what you expected to see..." style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;outline:none;resize:vertical;"></textarea>'
    + '  </div>'
    + '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '    <div>'
    + '      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Severity</label>'
    + '      <select id="tm-bug-sev" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;background:#ffffff;outline:none;">'
    + '        <option value="low">Low (Minor visual)</option>'
    + '        <option value="medium" selected>Medium (Normal issue)</option>'
    + '        <option value="high">High (Feature broken)</option>'
    + '        <option value="critical">Critical (System blocker)</option>'
    + '      </select>'
    + '    </div>'
    + '    <div>'
    + '      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Module / Area</label>'
    + '      <input type="text" id="tm-bug-module" placeholder="e.g. Checkout, Auth, UI" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;outline:none;" />'
    + '    </div>'
    + '  </div>'
    + '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '    <div>'
    + '      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Your Name (Optional)</label>'
    + '      <input type="text" id="tm-bug-name" placeholder="John Doe" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;outline:none;" />'
    + '    </div>'
    + '    <div>'
    + '      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Your Email (Optional)</label>'
    + '      <input type="email" id="tm-bug-email" placeholder="john@example.com" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;outline:none;" />'
    + '    </div>'
    + '  </div>'
    + '  <div>'
    + '    <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#334155;">Screenshot or Attachment (Optional)</label>'
    + '    <input type="file" id="tm-bug-files" accept="image/*,video/*,.pdf,.docx" multiple style="font-size:12px;color:#64748b;" />'
    + '  </div>'
    + '  <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:6px;">'
    + '    <button type="button" id="tm-bug-cancel-btn" style="padding:8px 16px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
    + '    <button type="submit" id="tm-bug-submit-btn" style="padding:8px 20px;background:' + primaryColor + ';color:#ffffff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">Submit Bug</button>'
    + '  </div>'
    + '</form>';

  overlay.appendChild(modal);
  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  function openModal() { overlay.style.display = 'flex'; }
  function closeModal() { overlay.style.display = 'none'; resetForm(); }

  btn.onclick = openModal;
  document.getElementById('tm-bug-close-btn').onclick = closeModal;
  document.getElementById('tm-bug-cancel-btn').onclick = closeModal;
  overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };

  var form = document.getElementById('tm-bug-form');
  var msgBox = document.getElementById('tm-bug-msg');
  var submitBtn = document.getElementById('tm-bug-submit-btn');

  function resetForm() {
    form.reset();
    msgBox.style.display = 'none';
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Submit Bug';
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    var title = document.getElementById('tm-bug-title').value.trim();
    var desc = document.getElementById('tm-bug-desc').value.trim();
    if (!title || !desc) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Submitting...';
    msgBox.style.display = 'none';

    var fileInput = document.getElementById('tm-bug-files');
    var files = fileInput.files;

    function proceedToPostBug(attachments) {
      var payload = {
        title: title,
        description: desc,
        websiteName: defaultWebsite,
        websiteUrl: window.location.origin,
        pageUrl: window.location.href,
        module: document.getElementById('tm-bug-module').value.trim() || 'General',
        severity: document.getElementById('tm-bug-sev').value,
        reporterName: document.getElementById('tm-bug-name').value.trim() || 'Website Visitor',
        reporterEmail: document.getElementById('tm-bug-email').value.trim(),
        attachments: attachments || [],
        browserInfo: {
          userAgent: navigator.userAgent,
          screenResolution: window.screen.width + 'x' + window.screen.height,
          language: navigator.language || '',
          platform: navigator.platform || ''
        }
      };

      fetch(apiBase + '/api/bugs/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(function() {
        msgBox.style.display = 'block';
        msgBox.style.background = '#dcfce7';
        msgBox.style.color = '#15803d';
        msgBox.style.border = '1px solid #bbf7d0';
        msgBox.innerHTML = '&#10003; Bug reported successfully! Our engineering team has been notified.';
        setTimeout(function() { closeModal(); }, 2000);
      })
      .catch(function(err) {
        msgBox.style.display = 'block';
        msgBox.style.background = '#fee2e2';
        msgBox.style.color = '#b91c1c';
        msgBox.style.border = '1px solid #fecaca';
        msgBox.innerHTML = 'Failed to submit bug: ' + (err.message || 'Please check your connection.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Retry Submit';
      });
    }

    if (files && files.length > 0) {
      var formData = new FormData();
      for (var i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      fetch(apiBase + '/api/bugs/external/upload', {
        method: 'POST',
        body: formData
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        proceedToPostBug(data.items || []);
      })
      .catch(function(err) {
        console.error('[TM Bug Widget] Upload failed:', err);
        proceedToPostBug([]);
      });
    } else {
      proceedToPostBug([]);
    }
  };
})();`;

  res.send(js);
});

// External bug report submission from other websites
router.post("/external", async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const websiteName = String(
      req.body?.websiteName ||
      req.body?.siteName ||
      req.headers["x-website-name"] ||
      "External Website"
    ).trim();
    const websiteUrl = String(
      req.body?.websiteUrl ||
      req.body?.siteUrl ||
      req.headers["origin"] ||
      req.headers["referer"] ||
      ""
    ).trim();
    const pageUrl = String(req.body?.pageUrl || req.body?.url || req.headers["referer"] || "").trim();
    const reporterName = String(req.body?.reporterName || req.body?.name || req.body?.userName || "External User").trim();
    const reporterEmail = String(req.body?.reporterEmail || req.body?.email || "").trim();
    const severity = String(req.body?.severity || "medium").toLowerCase();
    const priority = String(req.body?.priority || "medium").toLowerCase();
    const module = String(req.body?.module || "").trim();
    const attachmentsRaw = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!title) return res.status(400).json({ error: { message: "Bug title is required" } });
    if (!description) return res.status(400).json({ error: { message: "Bug description is required" } });

    const browserInfo = {
      userAgent: String(req.body?.browserInfo?.userAgent || req.headers["user-agent"] || "").slice(0, 500),
      screenResolution: String(req.body?.browserInfo?.screenResolution || "").slice(0, 50),
      language: String(req.body?.browserInfo?.language || req.headers["accept-language"] || "").slice(0, 50),
      platform: String(req.body?.browserInfo?.platform || "").slice(0, 50),
    };

    const created = await BugReport.create({
      title,
      description,
      status: "OPEN",
      severity: ["low", "medium", "high", "critical"].includes(severity) ? severity : "medium",
      priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
      company: websiteName,
      module: module || "External",
      websiteName,
      websiteUrl,
      pageUrl,
      reporterName,
      reporterEmail,
      browserInfo,
      originType: "EXTERNAL",
      createdByUserId: "EXTERNAL",
      createdByUsername: `${reporterName} (${websiteName})`,
      createdByRole: "external",
      source: {
        panel: "external-website",
        path: pageUrl || websiteUrl,
      },
      attachments: attachmentsRaw.map(att => ({
        fileName: String(att.fileName || ""),
        url: String(att.url || ""),
        mimeType: String(att.mimeType || ""),
        size: Number(att.size || 0),
        duration: Number(att.duration || 0),
        checksum: String(att.checksum || ""),
        processingStatus: "completed",
      })),
      lastActivity: new Date(),
    });

    const createdObj = withId(created);

    // Audit Event
    await BugEvent.create({
      bugId: created._id,
      actorId: "EXTERNAL",
      actorName: `${reporterName} (${websiteName})`,
      actorRole: "external",
      eventType: "BUG_CREATED",
      details: `Bug reported externally from ${websiteName} (${pageUrl || "Direct API"})`,
      metadata: { websiteName, websiteUrl, pageUrl, reporterEmail, severity, priority },
    }).catch(() => {});

    // Notification
    void createNotification({
      actor: `${reporterName} (${websiteName})`,
      actorRole: "external",
      action: "created",
      resourceType: "bug",
      resourceName: title,
      details: `Website: ${websiteName} | Module: ${module || "General"} | Severity: ${severity.toUpperCase()}`,
      resourceId: createdObj.id,
    });

    // Real-time Socket.io broadcast to online managers and developers
    if (global.io) {
      global.io.emit("new-bug", createdObj);
      global.io.emit("bug-created", createdObj);
    }

    return res.status(201).json({ success: true, item: createdObj });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// BUG REPORT MANAGEMENT APIs
// ----------------------------------------------------

// Create Bug Report
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const severity = String(req.body?.severity || "medium").toLowerCase();
    const priority = String(req.body?.priority || "medium").toLowerCase();
    const company = String(req.body?.company || "").trim();
    const module = String(req.body?.module || "").trim();
    const websiteName = String(req.body?.websiteName || company || "").trim();
    const websiteUrl = String(req.body?.websiteUrl || "").trim();
    const pageUrl = String(req.body?.pageUrl || "").trim();
    const reporterName = String(req.body?.reporterName || getUserName(req)).trim();
    const reporterEmail = String(req.body?.reporterEmail || "").trim();
    const originType = req.body?.originType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
    const assignedDeveloperId = String(req.body?.assignedDeveloperId || "").trim();
    const assignedDeveloperName = String(req.body?.assignedDeveloperName || "").trim();
    const attachmentsRaw = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const sourceRaw = req.body?.source && typeof req.body.source === "object" ? req.body.source : null;

    if (!title) return res.status(400).json({ error: { message: "Bug title is required" } });
    if (!description) return res.status(400).json({ error: { message: "Bug description is required" } });
    if (attachmentsRaw.length > 10) return res.status(400).json({ error: { message: "Maximum 10 attachments allowed" } });

    let task = null;
    if (taskId) {
      task = await Task.findById(taskId).lean();
      if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    }

    const created = await BugReport.create({
      ...(taskId ? { taskId } : {}),
      taskTitle: String(task?.title || ""),
      title,
      description,
      status: "OPEN",
      severity: ["low", "medium", "high", "critical"].includes(severity) ? severity : "medium",
      priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
      company,
      module,
      websiteName: websiteName || (originType === "INTERNAL" ? "Task Manager" : "External Website"),
      websiteUrl,
      pageUrl,
      reporterName,
      reporterEmail,
      originType,
      assignedDeveloperId,
      assignedDeveloperName,
      source: sourceRaw
        ? {
            panel: String(sourceRaw.panel || ""),
            path: String(sourceRaw.path || ""),
          }
        : undefined,
      attachments: attachmentsRaw.map(att => ({
        fileName: String(att.fileName || ""),
        url: String(att.url || ""),
        mimeType: String(att.mimeType || ""),
        size: Number(att.size || 0),
        duration: Number(att.duration || 0),
        resolution: String(att.resolution || ""),
        width: Number(att.width || 0),
        height: Number(att.height || 0),
        codec: String(att.codec || ""),
        compressedSize: Number(att.compressedSize || 0),
        checksum: String(att.checksum || ""),
        processingStatus: "completed",
      })),
      createdByUserId: getUserId(req),
      createdByUsername: getUserName(req),
      createdByRole: getUserRole(req),
      lastActivity: new Date(),
    });

    const createdObj = withId(created);

    // Audit Event
    await logBugEvent(created._id, req, "BUG_CREATED", `Bug "${title}" was reported.`, { severity, priority, websiteName });

    // Participant
    await BugParticipant.create({ bugId: created._id, userId: getUserId(req), username: getUserName(req) }).catch(() => {});

    // Notification
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "created",
      resourceType: "bug",
      resourceName: title,
      details: `${websiteName ? `Website: ${websiteName} | ` : ""}Module: ${module || "General"} | Severity: ${severity.toUpperCase()}`,
      resourceId: createdObj.id,
      assignees: assignedDeveloperName ? [assignedDeveloperName] : [],
    });

    return res.status(201).json({ item: createdObj });
  } catch (err) {
    return next(err);
  }
});

// Websites List for Filtering and Reporting
router.get("/websites/list", requireAuth, async (_req, res, next) => {
  try {
    const Website = require("../models/Website");
    const [registered, bugSites] = await Promise.all([
      Website.find({}).select("siteName url status").lean().catch(() => []),
      BugReport.distinct("websiteName").catch(() => []),
    ]);

    const siteMap = new Map();
    siteMap.set("Task Manager", { siteName: "Task Manager", url: "", isRegistered: true });

    (registered || []).forEach(w => {
      const name = String(w.siteName || "").trim();
      if (name) {
        siteMap.set(name, { siteName: name, url: w.url || "", isRegistered: true });
      }
    });

    (bugSites || []).forEach(s => {
      const trimmed = String(s || "").trim();
      if (trimmed && !siteMap.has(trimmed)) {
        siteMap.set(trimmed, { siteName: trimmed, url: "", isRegistered: false });
      }
    });

    return res.json({
      items: Array.from(siteMap.values()),
    });
  } catch (err) {
    return next(err);
  }
});

// Analytics Dashboard Endpoint
router.get("/analytics", requireAuth, async (req, res, next) => {
  try {
    const all = await BugReport.find({}, {
      status: 1,
      "resolution.submittedAt": 1,
      createdAt: 1,
      module: 1,
      websiteName: 1,
      originType: 1,
      assignedDeveloperName: 1,
      createdByUsername: 1,
    }).lean();

    const total = all.length;
    const pendingBugs = all.filter(b => ["OPEN", "TRIAGED", "IN_PROGRESS", "NEEDS_INFO", "REOPENED", "open"].includes(b.status)).length;
    const awaitingConfirmation = all.filter(b => b.status === "AWAITING_REPORTER_CONFIRMATION" || b.status === "RESOLUTION_SUBMITTED").length;
    const reopenedBugs = all.filter(b => b.status === "REOPENED").length;
    const closedVerified = all.filter(b => b.status === "CLOSED_VERIFIED" || b.status === "closed").length;

    // Calculate Average Resolution Time
    let totalResTimeMs = 0;
    let resCount = 0;
    all.forEach(b => {
      if (b.resolution?.submittedAt && b.createdAt) {
        const diff = new Date(b.resolution.submittedAt).getTime() - new Date(b.createdAt).getTime();
        if (diff > 0) {
          totalResTimeMs += diff;
          resCount++;
        }
      }
    });

    const avgResolutionTimeHours = resCount > 0 ? (totalResTimeMs / (1000 * 60 * 60 * resCount)).toFixed(1) : "0.0";
    const acceptanceRate = (closedVerified + awaitingConfirmation) > 0 ? Math.round((closedVerified / (closedVerified + reopenedBugs || 1)) * 100) : 100;
    const reopenRate = total > 0 ? Math.round((reopenedBugs / total) * 100) : 0;

    // Top Modules, Websites, Developers, Reporters
    const moduleMap = {};
    const websiteMap = {};
    const devMap = {};
    const reporterMap = {};

    all.forEach(b => {
      const mod = b.module || "General";
      moduleMap[mod] = (moduleMap[mod] || 0) + 1;

      const site = b.websiteName || (b.originType === "EXTERNAL" ? "External Website" : "Task Manager");
      websiteMap[site] = (websiteMap[site] || 0) + 1;

      if (b.assignedDeveloperName) {
        devMap[b.assignedDeveloperName] = (devMap[b.assignedDeveloperName] || 0) + 1;
      }
      if (b.createdByUsername) {
        reporterMap[b.createdByUsername] = (reporterMap[b.createdByUsername] || 0) + 1;
      }
    });

    return res.json({
      total,
      pendingBugs,
      awaitingConfirmation,
      reopenedBugs,
      closedVerified,
      avgResolutionTimeHours,
      acceptanceRate,
      reopenRate,
      topModules: Object.entries(moduleMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topWebsites: Object.entries(websiteMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      topDevelopers: Object.entries(devMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topReporters: Object.entries(reporterMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    });
  } catch (err) {
    return next(err);
  }
});

// List Bugs with Filters & Pagination (25 items per page default)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { company, module, severity, priority, status = "open", developer, reporter, website, websiteName, originType, q, page: rawPage, limit: rawLimit } = req.query;

    const page = Math.max(1, parseInt(rawPage, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(rawLimit, 10) || 25));
    const skip = (page - 1) * limit;

    const filter = {};

    if (company) filter.company = String(company);
    if (module) filter.module = String(module);
    if (severity && severity !== "all") filter.severity = String(severity);
    if (priority && priority !== "all") filter.priority = String(priority);

    const siteFilter = String(websiteName || website || "").trim();
    if (siteFilter && siteFilter !== "all") {
      if (siteFilter.toLowerCase() === "internal") {
        filter.originType = "INTERNAL";
      } else if (siteFilter.toLowerCase() === "external") {
        filter.originType = "EXTERNAL";
      } else {
        filter.websiteName = siteFilter;
      }
    }

    if (originType && originType !== "all") {
      filter.originType = String(originType).toUpperCase();
    }

    if (status && status !== "all") {
      if (status === "open") filter.status = { $in: ["OPEN", "TRIAGED", "IN_PROGRESS", "NEEDS_INFO", "REOPENED", "open"] };
      else if (status === "closed") filter.status = { $in: ["CLOSED_VERIFIED", "CLOSED_ADMIN_OVERRIDE", "closed"] };
      else filter.status = String(status);
    }

    if (developer) filter.assignedDeveloperName = new RegExp(String(developer), "i");
    if (reporter) filter.createdByUsername = new RegExp(String(reporter), "i");

    if (q) {
      const search = String(q).trim();
      filter.$or = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { taskTitle: new RegExp(search, "i") },
        { createdByUsername: new RegExp(search, "i") },
        { assignedDeveloperName: new RegExp(search, "i") },
        { module: new RegExp(search, "i") },
        { websiteName: new RegExp(search, "i") },
        { reporterName: new RegExp(search, "i") },
        { reporterEmail: new RegExp(search, "i") },
        { pageUrl: new RegExp(search, "i") },
      ];
    }

    const [totalItems, items] = await Promise.all([
      BugReport.countDocuments(filter),
      BugReport.find(filter)
        .sort({ lastActivity: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("title description status severity priority company module taskTitle createdByUsername createdByRole assignedDeveloperName createdAt source attachments.fileName attachments.url attachments.mimeType attachments.size websiteName websiteUrl pageUrl reporterName reporterEmail originType browserInfo")
        .lean(),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.json({
      items: items.map(withId),
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Get Single Bug Detail
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await BugReport.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Bug report not found" } });

    // Mark read for current user
    await BugParticipant.findOneAndUpdate(
      { bugId: req.params.id, userId: getUserId(req) },
      { username: getUserName(req), lastReadAt: new Date() },
      { upsert: true }
    ).catch(() => {});

    return res.json({ item: withId(item) });
  } catch (err) {
    return next(err);
  }
});

// Update Bug Details, Triage, Status & Assignment
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug not found" } });

    const role = getUserRole(req);
    const isPrivileged = ["admin", "super-admin", "manager"].includes(role);
    const isReporter = bug.createdByUserId === getUserId(req) || bug.createdByUsername === getUserName(req);

    const patch = { lastActivity: new Date() };

    // Triage / Priority / Severity / Assignment
    if (typeof req.body?.severity === "string") {
      patch.severity = req.body.severity;
      await logBugEvent(bug._id, req, "SEVERITY_CHANGED", `Severity changed to ${req.body.severity.toUpperCase()}`);
    }

    if (typeof req.body?.priority === "string") {
      patch.priority = req.body.priority;
      await logBugEvent(bug._id, req, "PRIORITY_CHANGED", `Priority changed to ${req.body.priority.toUpperCase()}`);
    }

    if (typeof req.body?.assignedDeveloperId === "string" || typeof req.body?.assignedDeveloperName === "string") {
      patch.assignedDeveloperId = String(req.body.assignedDeveloperId || "");
      patch.assignedDeveloperName = String(req.body.assignedDeveloperName || "");
      await logBugEvent(
        bug._id,
        req,
        "ASSIGNED",
        `Assigned to developer: ${patch.assignedDeveloperName || "Unassigned"}`
      );
    }

    // Status Updates
    if (typeof req.body?.status === "string") {
      const nextStatus = req.body.status.toUpperCase();

      // Developers must NEVER directly close a bug unless they are admin/manager or original reporter
      if (["CLOSED_VERIFIED", "CLOSED", "CLOSED_ADMIN_OVERRIDE"].includes(nextStatus) && !isPrivileged && !isReporter) {
        return res.status(403).json({
          error: { message: "Developers cannot directly close a bug. Please submit resolution for reporter confirmation." },
        });
      }

      patch.status = nextStatus;
      await logBugEvent(bug._id, req, "STATUS_CHANGED", `Status changed to ${nextStatus}`);
    }

    if (isPrivileged && (req.body?.title || req.body?.description)) {
      if (req.body.title) patch.title = req.body.title.trim();
      if (req.body.description) patch.description = req.body.description.trim();
    }

    const updated = await BugReport.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Dedicated Close Bug Endpoint
router.put("/:id/close", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const role = getUserRole(req);
    const isPrivileged = ["admin", "super-admin", "manager"].includes(role);
    const isReporter = bug.createdByUserId === getUserId(req) || bug.createdByUsername === getUserName(req);

    if (!isPrivileged && !isReporter) {
      return res.status(403).json({
        error: { message: "Only administrators, managers, or the original reporter can close this bug." },
      });
    }

    bug.status = "CLOSED_VERIFIED";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(bug._id, req, "STATUS_CHANGED", `Bug was closed by ${getUserName(req)}.`);
    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// CONVERSATION THREAD APIs
// ----------------------------------------------------

// Get Comments for Bug
router.get("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const comments = await BugComment.find({ bugId: req.params.id }).sort({ createdAt: 1 }).lean();
    return res.json({ items: comments.map(withId) });
  } catch (err) {
    return next(err);
  }
});

// Add Comment
router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug not found" } });

    const content = String(req.body?.content || "").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!content && !attachments.length) {
      return res.status(400).json({ error: { message: "Comment content or attachment is required" } });
    }

    if (content.length > 10000) {
      return res.status(400).json({ error: { message: "Comment exceeds 10,000 characters limit" } });
    }

    if (attachments.length > 10) {
      return res.status(400).json({ error: { message: "Maximum 10 attachments per comment allowed" } });
    }

    // Extract @mentions
    const mentions = (content.match(/@[\w\.-]+/g) || []).map(m => m.replace("@", ""));

    const comment = await BugComment.create({
      bugId: bug._id,
      userId: getUserId(req),
      username: getUserName(req),
      userRole: getUserRole(req),
      userAvatarUrl: String(req.body?.userAvatarUrl || ""),
      content,
      attachments,
      mentions,
    });

    const commentObj = withId(comment);

    await logBugEvent(bug._id, req, "COMMENT_ADDED", `${getUserName(req)} added a comment.`);

    // Notification
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "commented on",
      resourceType: "bug",
      resourceName: bug.title,
      details: content.substring(0, 80),
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername, bug.assignedDeveloperName].filter(Boolean),
    });

    return res.status(201).json({ item: commentObj });
  } catch (err) {
    return next(err);
  }
});

// Edit Comment (5-minute window rule)
router.put("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const comment = await BugComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { message: "Comment not found" } });

    if (comment.userId !== getUserId(req) && comment.username !== getUserName(req)) {
      return res.status(403).json({ error: { message: "You can only edit your own comment" } });
    }

    const elapsedMs = Date.now() - new Date(comment.createdAt).getTime();
    if (elapsedMs > 5 * 60 * 1000) {
      return res.status(400).json({ error: { message: "Comments can only be edited within 5 minutes of posting" } });
    }

    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: { message: "Comment content cannot be empty" } });

    comment.content = content;
    comment.isEdited = true;
    comment.editedAt = new Date();
    await comment.save();

    await logBugEvent(comment.bugId, req, "COMMENT_EDITED", `${getUserName(req)} edited their comment.`);

    return res.json({ item: withId(comment) });
  } catch (err) {
    return next(err);
  }
});

// Delete Comment (Soft Delete)
router.delete("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const comment = await BugComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { message: "Comment not found" } });

    const role = getUserRole(req);
    const isAdmin = ["admin", "super-admin"].includes(role);

    if (!isAdmin && comment.userId !== getUserId(req) && comment.username !== getUserName(req)) {
      return res.status(403).json({ error: { message: "Permission denied" } });
    }

    comment.isDeleted = true;
    comment.deletedAt = new Date();
    comment.content = "Comment Removed";
    comment.attachments = [];
    await comment.save();

    await logBugEvent(comment.bugId, req, "COMMENT_DELETED", `${getUserName(req)} removed a comment.`);

    return res.json({ item: withId(comment) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// RESOLUTION & REPORTER VERIFICATION WORKFLOW APIs
// ----------------------------------------------------

// Submit Resolution (Developers/Team Leads/Admins)
router.post("/:id/resolution", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const summary = String(req.body?.summary || "").trim();
    const verificationPerformed = String(req.body?.verificationPerformed || "").trim();
    const releaseVersion = String(req.body?.releaseVersion || "").trim();
    const deploymentEnvironment = String(req.body?.deploymentEnvironment || "").trim();
    const commitUrl = String(req.body?.commitUrl || "").trim();
    const pullRequestUrl = String(req.body?.pullRequestUrl || "").trim();
    const disposition = String(req.body?.disposition || "Fixed").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!summary) return res.status(400).json({ error: { message: "Resolution summary is required" } });
    if (!verificationPerformed) return res.status(400).json({ error: { message: "Verification performed details are required" } });

    bug.resolution = {
      summary,
      verificationPerformed,
      releaseVersion,
      deploymentEnvironment,
      commitUrl,
      pullRequestUrl,
      attachments,
      disposition,
      submittedBy: getUserName(req),
      submittedAt: new Date(),
    };

    bug.status = "AWAITING_REPORTER_CONFIRMATION";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(
      bug._id,
      req,
      "RESOLUTION_SUBMITTED",
      `Resolution submitted by ${getUserName(req)}. Awaiting reporter confirmation.`,
      { disposition, releaseVersion }
    );

    // Notify original reporter
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "submitted resolution for",
      resourceType: "bug",
      resourceName: bug.title,
      details: summary.substring(0, 100),
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Confirm Resolution (Reporter Verification - YES)
router.post("/:id/confirm-resolution", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const role = getUserRole(req);
    const isAdmin = ["admin", "super-admin"].includes(role);
    const isReporter = bug.createdByUserId === getUserId(req) || bug.createdByUsername === getUserName(req);

    if (!isReporter && !isAdmin) {
      return res.status(403).json({ error: { message: "Only the original reporter can verify the resolution." } });
    }

    const { confirmed, feedback, rejectionReason } = req.body || {};

    if (confirmed === false || confirmed === "no") {
      // Reporter Rejected -> REOPENED
      bug.status = "REOPENED";
      bug.verification = {
        reporterConfirmed: false,
        confirmedAt: new Date(),
        rejectionReason: String(rejectionReason || feedback || "Issue still persists.").trim(),
      };
      bug.lastActivity = new Date();
      await bug.save();

      await logBugEvent(
        bug._id,
        req,
        "REPORTER_REJECTED",
        `Reporter ${getUserName(req)} rejected the fix. Bug reopened. Reason: ${bug.verification.rejectionReason}`
      );

      // Notify developer
      void createNotification({
        actor: getUserName(req),
        actorRole: getUserRole(req),
        action: "rejected resolution and reopened",
        resourceType: "bug",
        resourceName: bug.title,
        details: bug.verification.rejectionReason,
        resourceId: String(bug._id),
        assignees: [bug.assignedDeveloperName],
      });

      return res.json({ item: withId(bug) });
    }

    // Reporter Confirmed -> CLOSED_VERIFIED
    bug.status = "CLOSED_VERIFIED";
    bug.verification = {
      reporterConfirmed: true,
      confirmedAt: new Date(),
      feedback: String(feedback || "Verified and confirmed fix.").trim(),
    };
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(
      bug._id,
      req,
      "REPORTER_CONFIRMED",
      `Reporter ${getUserName(req)} verified the fix. Bug closed.`
    );

    // Notify developer
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "verified and closed",
      resourceType: "bug",
      resourceName: bug.title,
      details: bug.verification.feedback,
      resourceId: String(bug._id),
      assignees: [bug.assignedDeveloperName],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Request Information (NEEDS_INFO)
router.post("/:id/request-info", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const note = String(req.body?.note || "").trim();
    bug.status = "NEEDS_INFO";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(bug._id, req, "INFO_REQUESTED", `Developer requested more info: ${note}`);

    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "requested info on",
      resourceType: "bug",
      resourceName: bug.title,
      details: note,
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Admin Force Close Override
router.post("/:id/admin-override", requireAuth, async (req, res, next) => {
  try {
    const role = getUserRole(req);
    if (!["admin", "super-admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Admin override requires admin privileges." } });
    }

    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const reason = String(req.body?.reason || "Admin override close").trim();
    bug.status = "CLOSED_ADMIN_OVERRIDE";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(bug._id, req, "ADMIN_OVERRIDE", `Admin ${getUserName(req)} override closed the bug. Reason: ${reason}`);

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// AUDIT TRAIL / ACTIVITY LOG APIs
// ----------------------------------------------------

router.get("/:id/events", requireAuth, async (req, res, next) => {
  try {
    const events = await BugEvent.find({ bugId: req.params.id }).sort({ createdAt: -1 }).lean();
    return res.json({ items: events.map(withId) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
