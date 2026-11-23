/* ------------------------------------------------------------------ *
 * AiOrchestrator — auto-tagging/categorization/summary/dedupe/embeddings.
 * Human-in-the-loop: AI writes *suggestions* (pending), never mutates a
 * note directly. Applying a suggestion is a user action (NoteService) that
 * is audited and undoable.
 * ------------------------------------------------------------------ */
const models = require("../../../models/knowledge");
const { embeddingRepository, suggestionRepository } = require("../../../repositories/knowledge");
const { getProvider } = require("./providers");

const EMBED_DIM = Number(process.env.KV_EMBED_DIM) || 256;

function cosine(a = [], b = []) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are pre-normalized
}

const AiOrchestrator = {
  provider: getProvider(),

  /** (Re)embed a note only when its content hash changed. Vector-DB ready. */
  async embedNote(note) {
    const text = `${note.title}\n${(note.body && note.body.plain) || note.content || ""}`;
    const existing = await models.NoteEmbedding.findOne({ noteId: note._id }).lean();
    if (existing && existing.contentHash === note.contentHash) return existing;
    const vector = await this.provider.embed(text, EMBED_DIM);
    return models.NoteEmbedding.findOneAndUpdate(
      { noteId: note._id },
      {
        noteId: note._id,
        organizationId: note.organizationId || null,
        model: this.provider.model,
        dim: EMBED_DIM,
        vector,
        chunk: { index: 0, text: text.slice(0, 2000) },
        contentHash: note.contentHash,
      },
      { upsert: true, new: true }
    );
  },

  /** Produce pending suggestions (tags, category, summary, keywords). */
  async analyze(ctx, note) {
    const text = `${note.title}\n${(note.body && note.body.plain) || note.content || ""}`;
    const [keywords, summary, classification] = await Promise.all([
      this.provider.keywords(text, 8),
      this.provider.summarize(text),
      this.provider.classify(text),
    ]);
    const suggestions = [
      { type: "tag", payload: { tags: keywords.slice(0, 5) }, confidence: 0.6 },
      { type: "keywords", payload: { keywords }, confidence: 0.7 },
      { type: "summary", payload: { summary }, confidence: 0.7 },
      { type: "category", payload: { label: classification.label }, confidence: classification.confidence },
    ];
    const docs = await models.AiSuggestion.insertMany(
      suggestions.map((s) => ({
        noteId: note._id,
        organizationId: note.organizationId || null,
        type: s.type,
        payload: s.payload,
        confidence: s.confidence,
        status: "pending",
        model: this.provider.model,
      }))
    );
    await this.embedNote(note); // keep vector fresh
    await this.detectDuplicates(ctx, note); // may add "duplicate" relationships
    return docs;
  },

  /** Cosine similarity over embeddings → duplicate/related edges. */
  async detectDuplicates(ctx, note, threshold = 0.85) {
    const mine = await models.NoteEmbedding.findOne({ noteId: note._id }).lean();
    if (!mine) return [];
    const orgFilter = note.organizationId ? { organizationId: note.organizationId } : {};
    const others = await models.NoteEmbedding.find({ ...orgFilter, noteId: { $ne: note._id } })
      .limit(500)
      .lean();
    const hits = [];
    for (const o of others) {
      const score = cosine(mine.vector, o.vector);
      if (score >= threshold) {
        await models.NoteRelationship.findOneAndUpdate(
          { from: note._id, to: o.noteId, type: "duplicate" },
          {
            from: note._id,
            to: o.noteId,
            type: "duplicate",
            weight: score,
            source: "ai",
            organizationId: note.organizationId || null,
          },
          { upsert: true }
        );
        hits.push({ noteId: o.noteId, score });
      }
    }
    return hits;
  },

  /** Semantic search: embed the query and rank authorized notes by cosine. */
  async semanticSearch(ctx, queryText, { limit = 20, candidates = 500 } = {}) {
    const qv = await this.provider.embed(queryText, EMBED_DIM);
    const orgFilter = ctx.organizationId && !["super-admin", "admin"].includes(ctx.role)
      ? { organizationId: ctx.organizationId }
      : {};
    const rows = await models.NoteEmbedding.find(orgFilter).limit(candidates).lean();
    return rows
      .map((r) => ({ noteId: r.noteId, score: cosine(qv, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  /** Apply an accepted suggestion. Note-field changes go through NoteService so
   *  they are versioned/audited/undoable; ai.* metadata is written directly. */
  async acceptSuggestion(ctx, suggestionId, NoteService) {
    const s = await models.AiSuggestion.findById(suggestionId);
    if (!s || s.status !== "pending") return null;
    const { noteRepository } = require("../../../repositories/knowledge");
    const applied = {};

    if (s.type === "tag") {
      await NoteService.update(ctx, String(s.noteId), { tags: s.payload.tags || [] });
      applied.tags = s.payload.tags || [];
    } else if (s.type === "summary" || s.type === "keywords" || s.type === "category") {
      // AI-derived metadata lives on the note's `ai` block (not user content).
      const note = await noteRepository.rawById(s.noteId);
      if (note) {
        note.ai = { ...(note.ai || {}), model: this.provider.model, generatedAt: new Date() };
        if (s.type === "summary") note.ai.summary = s.payload.summary;
        if (s.type === "keywords") note.ai.keywords = s.payload.keywords || [];
        if (s.type === "category") note.ai.classification = s.payload.label || "";
        await note.save();
        applied[s.type] = s.payload;
      }
    }

    s.status = "accepted";
    s.reviewedBy = ctx.userId;
    s.reviewedAt = new Date();
    await s.save();
    return { applied };
  },

  async rejectSuggestion(ctx, suggestionId) {
    const s = await models.AiSuggestion.findById(suggestionId);
    if (!s) return null;
    s.status = "rejected";
    s.reviewedBy = ctx.userId;
    s.reviewedAt = new Date();
    await s.save();
    return { ok: true };
  },

  async chat(ctx, sessionId, message) {
    const session = await models.AiSession.findById(sessionId);
    if (!session) return null;
    session.messages.push({ role: "user", content: message, at: new Date() });
    // RAG hook: semanticSearch(ctx, message) → hydrate authorized notes → context.
    const answer = await this.provider.chat(session.messages);
    session.messages.push({ role: "assistant", content: answer.content, tokens: answer.tokens, at: new Date() });
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // sliding TTL
    await session.save();
    return answer;
  },
};

module.exports = AiOrchestrator;
