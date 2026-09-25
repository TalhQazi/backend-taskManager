const express = require("express");
const SearchService = require("../../services/knowledge/SearchService");
const { kvContext, wrap } = require("./context");

const router = express.Router();

// GET /search?q=&mode=text|semantic|hybrid&limit=
router.get("/", wrap(async (req, res) => {
  const ctx = kvContext(req);
  res.json(await SearchService.search(ctx, {
    q: req.query.q,
    mode: req.query.mode || "text",
    limit: Math.min(100, parseInt(req.query.limit, 10) || 25),
  }));
}));

// POST /search/nl  { phrase }
router.post("/nl", wrap(async (req, res) => {
  res.json(await SearchService.naturalLanguage(kvContext(req), String(req.body?.phrase || "")));
}));

module.exports = router;
