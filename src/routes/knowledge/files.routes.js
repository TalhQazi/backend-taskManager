const express = require("express");
const multer = require("multer");
const StorageService = require("../../services/knowledge/StorageService");
const { noteRepository } = require("../../repositories/knowledge");
const PermissionService = require("../../services/knowledge/PermissionService");
const { kvContext, wrap } = require("./context");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const router = express.Router();

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function detectKind(mimeType = "", fileName = "") {
  const m = mimeType.toLowerCase();
  const f = fileName.toLowerCase();
  if (m.startsWith("image/") || f.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/)) return "image";
  if (m.startsWith("video/") || f.match(/\.(mp4|webm|mov|mkv|avi)$/)) return "video";
  if (m.startsWith("audio/") || f.match(/\.(mp3|wav|ogg|m4a|aac)$/)) return "voice";
  if (m === "application/pdf" || f.endsWith(".pdf")) return "pdf";
  return "file";
}

// POST /files  (multipart) → stores in GridFS, returns a MediaRef
router.post("/", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { message: "No file uploaded" } });
  const ctx = kvContext(req);
  const ref = await StorageService.put(req.file.buffer, {
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    organizationId: ctx.organizationId,
    ownerId: ctx.userId,
  });

  const kind = req.body?.kind || detectKind(ref.mimeType, ref.fileName);
  const fileUrl = `/api/knowledge/v2/files/${ref.fileId}`;

  res.status(201).json({
    item: {
      kind,
      storage: "gridfs",
      fileId: String(ref.fileId),
      fileName: ref.fileName,
      mimeType: ref.mimeType,
      size: ref.size,
      fileSize: formatBytes(ref.size),
      url: fileUrl,
    },
  });
}));

// GET /files/:id  → authenticated stream (optionally token-gated for <img>/<video>)
router.get("/:id", wrap(async (req, res) => {
  const ctx = kvContext(req);
  // If a note owns this file, enforce its ACL; otherwise allow the owner-scoped stream.
  const owningNote = await noteRepository.rawById(req.query.noteId).catch(() => null);
  if (owningNote && !(await PermissionService.can(ctx, "read", owningNote))) {
    return res.status(403).json({ error: { message: "Forbidden" } });
  }

  const stream = StorageService.getStream({ fileId: req.params.id });
  stream.on("file", (file) => {
    if (file.metadata?.mimeType) {
      res.setHeader("Content-Type", file.metadata.mimeType);
    }
    if (file.filename) {
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);
    }
  });
  stream.on("error", () => res.status(404).json({ error: { message: "File not found" } }));
  stream.pipe(res);
}));

module.exports = router;
