const express = require("express");
const { FolderService, CategoryService, TagService } = require("../../services/knowledge/taxonomy.service");
const { createFolder, createCategory } = require("../../validation/knowledge/schemas");
const { kvContext, wrap } = require("./context");

const router = express.Router();

/* ----- Folders ----- */
router.get("/folders", wrap(async (req, res) => res.json({ items: await FolderService.list(kvContext(req)) })));
router.post("/folders", wrap(async (req, res) => {
  const parsed = createFolder.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
  res.status(201).json({ item: await FolderService.create(kvContext(req), parsed.data) });
}));
router.patch("/folders/:id", wrap(async (req, res) => res.json({ item: await FolderService.update(kvContext(req), req.params.id, req.body || {}) })));
router.delete("/folders/:id", wrap(async (req, res) => { await FolderService.remove(kvContext(req), req.params.id); res.json({ ok: true }); }));

/* ----- Categories ----- */
router.get("/categories", wrap(async (req, res) => res.json({ items: await CategoryService.list(kvContext(req)) })));
router.post("/categories", wrap(async (req, res) => {
  const parsed = createCategory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
  res.status(201).json({ item: await CategoryService.create(kvContext(req), parsed.data) });
}));
router.patch("/categories/:id", wrap(async (req, res) => res.json({ item: await CategoryService.update(kvContext(req), req.params.id, req.body || {}) })));
router.delete("/categories/:id", wrap(async (req, res) => { await CategoryService.remove(kvContext(req), req.params.id); res.json({ ok: true }); }));

/* ----- Tags ----- */
router.get("/tags", wrap(async (req, res) => res.json({ items: await TagService.list(kvContext(req)) })));
router.post("/tags", wrap(async (req, res) => res.status(201).json({ item: await TagService.ensure(kvContext(req), req.body?.name) })));

module.exports = router;
