/* ------------------------------------------------------------------ *
 * AI providers — swappable behind one interface. The default is a
 * deterministic LOCAL provider that needs no API key and no network, so
 * the module is fully functional out of the box. Wire a real provider
 * (Anthropic Claude — latest Fable 5 / Opus 4.8 — or OpenAI) by setting
 * KV_AI_PROVIDER and the matching key; keep model ids in config, never
 * hardcoded in business logic.
 * ------------------------------------------------------------------ */
const crypto = require("crypto");

const STOP = new Set(
  "a an the and or but of to in on for with at by from is are was were be been being this that it as we you they i".split(" ")
);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Deterministic, offline provider — good enough for tagging/summary/embeddings readiness. */
const LocalProvider = {
  name: "local",
  model: "local-heuristic-v1",

  async keywords(text, k = 8) {
    const freq = {};
    for (const w of tokenize(text)) freq[w] = (freq[w] || 0) + 1;
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([w]) => w);
  },

  async summarize(text) {
    const sentences = String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    const kws = await this.keywords(text, 6);
    const scored = sentences
      .map((s) => ({ s, score: tokenize(s).filter((w) => kws.includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((x) => x.s);
    return (scored.join(" ") || sentences.slice(0, 2).join(" ")).slice(0, 500);
  },

  async classify(text) {
    const kws = await this.keywords(text, 3);
    return { label: kws[0] || "general", confidence: kws.length ? 0.5 : 0.2 };
  },

  /** Deterministic hashing embedding — dimensionality-stable, cosine-comparable.
   *  Not semantic, but lets the vector pipeline (storage, k-NN plumbing) work
   *  end-to-end until a real embedding model is configured. */
  async embed(text, dim = 256) {
    const vec = new Array(dim).fill(0);
    for (const w of tokenize(text)) {
      const h = crypto.createHash("md5").update(w).digest();
      const idx = h.readUInt32BE(0) % dim;
      vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  },

  async chat(messages) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    return { content: `【local】I received: "${(last && last.content) || ""}". Configure KV_AI_PROVIDER for full answers.`, tokens: 0 };
  },
};

function getProvider() {
  // Extension point: switch on process.env.KV_AI_PROVIDER → AnthropicProvider / OpenAIProvider.
  return LocalProvider;
}

module.exports = { getProvider, LocalProvider, tokenize };
