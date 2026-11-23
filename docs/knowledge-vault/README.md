# Knowledge Vault v2 — module guide

Enterprise Knowledge Vault built on your existing MongoDB/Mongoose stack.
**Additive and always on** — the v2 API mounts automatically and the frontend
screen appears for admin/super-admin. No env flags required. See `ARCHITECTURE.md`
for the full design.

## Configuration (all optional)

```bash
# .env — optional tuning only
KV_EMBED_DIM=256            # embedding dimensionality (local provider)
KV_AI_PROVIDER=local        # 'local' (offline, default). Wire Anthropic/OpenAI later.
```

Nothing needs to be set for the module to work — it runs on the same MongoDB
connection and JWT auth as the rest of the app.

## One-time migration (recommended, not required)

```bash
# Makes EXISTING notes fully searchable/AI-ready. New notes are handled
# automatically by the model's save hook, so this is a backfill for old data.
node src/migrations/knowledge/002_backfill.js
# or run everything (also ensures indexes, though Mongoose autoIndex builds them too):
node src/migrations/knowledge/run.js all
```

The original `notes` collection, its `$text` index, and `/api/notes` are untouched.
Indexes for the new collections are built automatically by Mongoose on startup;
`001_indexes` just lets you build them as a controlled step on a large dataset.

## What ships

| Area | Files |
|---|---|
| Evolved note model | `src/models/Note.js` (same collection, backward compatible) |
| New collections | `src/models/knowledge/index.js` (15 `kv_*` collections) |
| Repositories | `src/repositories/knowledge/` (org-scope + soft-delete in `BaseRepository`) |
| Services | `src/services/knowledge/` (Note, Permission, Share, Taxonomy, Search, Storage, governance, AI) |
| Storage | GridFS (`StorageService`) — **no S3** |
| AI | `src/services/knowledge/ai/` (provider-agnostic; offline local default) |
| Validation | `src/validation/knowledge/schemas.js` (zod DTOs) |
| API | `src/routes/knowledge/` → `/api/knowledge/v2/*` |
| Migrations | `src/migrations/knowledge/` |

## Key endpoints (`/api/knowledge/v2`)

```
GET/POST/PATCH/DELETE  /notes          + /notes/:id/{restore,pin,favorite,important,versions,related,analyze}
GET/POST/PATCH/DELETE  /folders /categories        POST/GET /tags
POST /notes/:id/share   GET /notes/:id/shares   DELETE /shares/:id
GET  /search?q=&mode=text|semantic|hybrid         POST /search/nl
POST /ai/sessions  /ai/sessions/:id/message       GET /ai/suggestions   POST /ai/suggestions/:id/{accept,reject}
POST /files (multipart→GridFS)   GET /files/:id    GET /activity   GET /audit   POST /undo/:actionId
```

## Design guarantees

- **Backward compatible**: new note fields are optional-with-defaults; existing docs valid; `/api/notes` unchanged.
- **Multi-tenant safe**: org isolation + soft-delete live in `BaseRepository` — a handler can't forget them.
- **AI is human-in-the-loop**: AI writes *pending suggestions*; applying is a user action that is audited and undoable.
- **Vector-ready**: `kv_note_embeddings` + cosine search work today with the offline provider; swap in a real embedding model or a vector DB (Atlas Vector Search / Qdrant) behind the same interface.
