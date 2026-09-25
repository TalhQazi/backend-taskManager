const express = require("express");
const NoteService = require("../../services/knowledge/NoteService");
const AiOrchestrator = require("../../services/knowledge/ai/AiOrchestrator");
const { noteRepository } = require("../../repositories/knowledge");
const { createNote, updateNote } = require("../../validation/knowledge/schemas");
const { kvContext, wrap, handleSentinel } = require("./context");

const router = express.Router();

router.get("/", wrap(async (req, res) => {
  res.json(await NoteService.list(kvContext(req), req.query));
}));

router.post("/", wrap(async (req, res) => {
  const parsed = createNote.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
  const note = await NoteService.create(kvContext(req), parsed.data);
  res.status(201).json({ item: note });
}));

router.get("/:id", wrap(async (req, res) => {
  const result = await NoteService.get(kvContext(req), req.params.id);
  if (handleSentinel(res, result)) return;
  res.json({ item: result });
}));

router.patch("/:id", wrap(async (req, res) => {
  const parsed = updateNote.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
  const result = await NoteService.update(kvContext(req), req.params.id, parsed.data);
  if (handleSentinel(res, result)) return;
  res.json({ item: result });
}));

router.delete("/:id", wrap(async (req, res) => {
  const result = await NoteService.remove(kvContext(req), req.params.id);
  if (handleSentinel(res, result)) return;
  res.json({ ok: true });
}));

router.post("/:id/restore", wrap(async (req, res) => {
  const result = await NoteService.restore(kvContext(req), req.params.id);
  if (handleSentinel(res, result)) return;
  res.json({ item: result });
}));

// pin / favorite / important toggles
for (const flag of ["pin", "favorite", "important"]) {
  const field = flag === "pin" ? "isPinned" : flag === "favorite" ? "isFavorite" : "isImportant";
  router.post(`/:id/${flag}`, wrap(async (req, res) => {
    const result = await NoteService.update(kvContext(req), req.params.id, { [field]: req.body?.value !== false });
    if (handleSentinel(res, result)) return;
    res.json({ item: result });
  }));
}

// Version history
router.get("/:id/versions", wrap(async (req, res) => {
  const result = await NoteService.versions(kvContext(req), req.params.id);
  if (result === null) return res.status(404).json({ error: { message: "Not found" } });
  res.json({ items: result });
}));

router.post("/:id/versions/:version/restore", wrap(async (req, res) => {
  const result = await NoteService.restoreVersion(kvContext(req), req.params.id, Number(req.params.version));
  if (handleSentinel(res, result)) return;
  res.json({ item: result });
}));

// Related notes (knowledge graph)
router.get("/:id/related", wrap(async (req, res) => {
  const models = require("../../models/knowledge");
  const edges = await models.NoteRelationship.find({ $or: [{ from: req.params.id }, { to: req.params.id }] })
    .sort({ weight: -1 })
    .limit(50)
    .lean();
  res.json({ items: edges });
}));

// Trigger AI analysis → pending suggestions (human-approved)
router.post("/:id/analyze", wrap(async (req, res) => {
  const ctx = kvContext(req);
  const note = await noteRepository.rawById(req.params.id);
  if (!note) return res.status(404).json({ error: { message: "Not found" } });
  const suggestions = await AiOrchestrator.analyze(ctx, note);
  res.json({ items: suggestions });
}));

module.exports = router;
