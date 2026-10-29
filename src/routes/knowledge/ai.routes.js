const express = require("express");
const models = require("../../models/knowledge");
const AiOrchestrator = require("../../services/knowledge/ai/AiOrchestrator");
const NoteService = require("../../services/knowledge/NoteService");
const { kvContext, wrap } = require("./context");

const router = express.Router();

// Sessions (chat / voice). Ephemeral — TTL-purged.
router.post("/sessions", wrap(async (req, res) => {
  const ctx = kvContext(req);
  const session = await models.AiSession.create({
    userId: ctx.userId,
    organizationId: ctx.organizationId || null,
    kind: req.body?.kind || "chat",
    context: { noteIds: req.body?.noteIds || [], scope: req.body?.scope || "org" },
    model: AiOrchestrator.provider.model,
  });
  res.status(201).json({ item: session });
}));

router.post("/sessions/:id/message", wrap(async (req, res) => {
  const answer = await AiOrchestrator.chat(kvContext(req), req.params.id, String(req.body?.message || ""));
  if (!answer) return res.status(404).json({ error: { message: "Session not found" } });
  res.json({ item: answer });
}));

// Suggestions inbox
router.get("/suggestions", wrap(async (req, res) => {
  const ctx = kvContext(req);
  const filter = { status: req.query.status || "pending" };
  if (ctx.organizationId) filter.organizationId = ctx.organizationId;
  res.json({ items: await models.AiSuggestion.find(filter).sort({ createdAt: -1 }).limit(200).lean() });
}));

router.post("/suggestions/:id/accept", wrap(async (req, res) => {
  const result = await AiOrchestrator.acceptSuggestion(kvContext(req), req.params.id, NoteService);
  if (!result) return res.status(404).json({ error: { message: "Not found or already reviewed" } });
  res.json(result);
}));

router.post("/suggestions/:id/reject", wrap(async (req, res) => {
  const result = await AiOrchestrator.rejectSuggestion(kvContext(req), req.params.id);
  if (!result) return res.status(404).json({ error: { message: "Not found" } });
  res.json(result);
}));

module.exports = router;
