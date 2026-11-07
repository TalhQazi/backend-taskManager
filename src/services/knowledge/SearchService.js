/* ------------------------------------------------------------------ *
 * SearchService — three modes behind one interface:
 *   text     : Mongo $text on the notes text index (works today)
 *   semantic : cosine over embeddings (AiOrchestrator)
 *   hybrid   : reciprocal-rank fusion of text + semantic
 * Every mode is authorization-scoped BEFORE results leave the DB.
 * ------------------------------------------------------------------ */
const { noteRepository } = require("../../repositories/knowledge");
const PermissionService = require("./PermissionService");
const AiOrchestrator = require("./ai/AiOrchestrator");

async function textSearch(ctx, q, limit) {
  const sharedIds = await PermissionService.sharedNoteIds(ctx);
  const filter = { ...noteRepository.visibilityFilter(ctx, sharedIds), $text: { $search: q } };
  const rows = await noteRepository.find(ctx, filter, {
    limit,
    select: "title content tags status priority updatedAt ai.summary",
    sort: { updatedAt: -1 },
  });
  return rows.map((r, i) => ({ ...r, id: r._id, _rank: i + 1 }));
}

const SearchService = {
  async search(ctx, { q, mode = "text", limit = 25 }) {
    if (!q || !q.trim()) return { items: [], mode };
    if (mode === "text") return { items: await textSearch(ctx, q, limit), mode };

    if (mode === "semantic" || mode === "hybrid") {
      const semantic = await AiOrchestrator.semanticSearch(ctx, q, { limit });
      if (mode === "semantic") {
        const ids = semantic.map((s) => s.noteId);
        const notes = await noteRepository.find(ctx, { _id: { $in: ids } }, {
          select: "title content tags status priority updatedAt ai.summary",
        });
        const order = new Map(ids.map((id, i) => [String(id), i]));
        notes.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
        return { items: notes.map((n) => ({ ...n, id: n._id })), mode };
      }
      // hybrid: reciprocal-rank fusion (k=60)
      const text = await textSearch(ctx, q, limit);
      const fused = new Map();
      const add = (id, rank) => fused.set(String(id), (fused.get(String(id)) || 0) + 1 / (60 + rank));
      text.forEach((t, i) => add(t.id, i + 1));
      semantic.forEach((s, i) => add(s.noteId, i + 1));
      const rankedIds = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
      const notes = await noteRepository.find(ctx, { _id: { $in: rankedIds } }, {
        select: "title content tags status priority updatedAt ai.summary",
      });
      const pos = new Map(rankedIds.map((id, i) => [String(id), i]));
      notes.sort((a, b) => pos.get(String(a._id)) - pos.get(String(b._id)));
      return { items: notes.map((n) => ({ ...n, id: n._id })), mode };
    }
    return { items: [], mode };
  },

  /** Natural-language search: translate phrase → structured filter, then run. */
  async naturalLanguage(ctx, phrase) {
    // Lightweight local intent parse; swap for an AI call when a provider is set.
    const q = phrase.replace(/\b(find|show|search|notes?|about|for|me|my|all)\b/gi, "").trim();
    return this.search(ctx, { q: q || phrase, mode: "hybrid" });
  },
};

module.exports = SearchService;
