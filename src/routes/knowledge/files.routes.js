const express = require("express");
const multer = require("multer");
const StorageService = require("../../services/knowledge/StorageService");
const { noteRepository } = require("../../repositories/knowledge");
const PermissionService = require("../../services/knowledge/PermissionService");
const { kvContext, wrap } = require("./context");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const router = express.Router();

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
  res.status(201).json({
    item: {
      kind: req.body?.kind || (req.file.mimetype.startsWith("image/") ? "image" : "file"),
      storage: "gridfs",
      fileId: ref.fileId,
      fileName: ref.fileName,
      mimeType: ref.mimeType,
      size: ref.size,
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
  stream.on("error", () => res.status(404).json({ error: { message: "File not found" } }));
  stream.pipe(res);
}));

module.exports = router;
