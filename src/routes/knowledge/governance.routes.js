const express = require("express");
const { AuditService, ActivityService, UndoService } = require("../../services/knowledge/governance");
const NoteService = require("../../services/knowledge/NoteService");
const { noteRepository } = require("../../repositories/knowledge");
const { kvContext, wrap } = require("./context");

const router = express.Router();

router.get("/activity", wrap(async (req, res) => {
  res.json({ items: await ActivityService.feed(kvContext(req), { limit: Math.min(100, parseInt(req.query.limit, 10) || 50) }) });
}));

// Audit is admin-only.
router.get("/audit", wrap(async (req, res) => {
  const ctx = kvContext(req);
  if (!["super-admin", "admin"].includes(ctx.role)) return res.status(403).json({ error: { message: "Forbidden" } });
  res.json({ items: await AuditService.list(ctx, { limit: Math.min(200, parseInt(req.query.limit, 10) || 50) }) });
}));

// Undo a previous reversible action (including AI actions).
router.post("/undo/:actionId", wrap(async (req, res) => {
  const ctx = kvContext(req);
  const entry = await UndoService.pop(ctx, req.params.actionId);
  if (!entry) return res.status(404).json({ error: { message: "Nothing to undo" } });
  if (entry.resourceType === "note" && entry.resourceId) {
    const note = await noteRepository.rawById(entry.resourceId);
    if (note) {
      Object.assign(note, entry.inverse || {});
      if (entry.action !== "note.delete") note.version = (note.version || 1) + 1;
      await note.save();
    }
  }
  res.json({ ok: true, reverted: entry.action });
}));

module.exports = router;
