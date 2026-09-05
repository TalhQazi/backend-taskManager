const express = require("express");
const ShareService = require("../../services/knowledge/ShareService");
const { createShare } = require("../../validation/knowledge/schemas");
const { kvContext, wrap, handleSentinel } = require("./context");

const router = express.Router();

router.get("/notes/:id/shares", wrap(async (req, res) => {
  const result = await ShareService.list(kvContext(req), req.params.id);
  if (result === null) return res.status(404).json({ error: { message: "Not found" } });
  res.json({ items: result });
}));

router.post("/notes/:id/share", wrap(async (req, res) => {
  const parsed = createShare.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
  const result = await ShareService.create(kvContext(req), req.params.id, parsed.data);
  if (handleSentinel(res, result)) return;
  res.status(201).json({ item: result });
}));

router.delete("/shares/:shareId", wrap(async (req, res) => {
  const result = await ShareService.revoke(kvContext(req), req.params.shareId);
  if (handleSentinel(res, result)) return;
  res.json({ ok: true });
}));

module.exports = router;
