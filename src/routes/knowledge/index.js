/* ------------------------------------------------------------------ *
 * Knowledge Vault v2 API — mounted at /api/knowledge/v2
 * Uses the existing requireAuth (and requireClearHire, matching /api/notes).
 * The legacy /api/notes surface is untouched and keeps working.
 * ------------------------------------------------------------------ */
const express = require("express");
const { requireAuth } = require("../../middleware/auth");

const router = express.Router();

// Every v2 route requires authentication (same JWT as the rest of the app).
router.use(requireAuth);

router.get("/health", (req, res) => res.json({ ok: true, module: "knowledge-vault", version: "v2" }));

// Order matters: mount specific/shared routers before the note :id catch-alls.
router.use("/", require("./taxonomy.routes")); // /folders /categories /tags
router.use("/", require("./shares.routes")); // /notes/:id/share, /shares/:id
router.use("/", require("./governance.routes")); // /activity /audit /undo/:id
router.use("/search", require("./search.routes"));
router.use("/ai", require("./ai.routes"));
router.use("/files", require("./files.routes"));
router.use("/notes", require("./notes.routes"));

module.exports = router;
