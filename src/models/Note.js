const mongoose = require("mongoose");
const crypto = require("crypto");

const { Schema } = mongoose;

/* ------------------------------------------------------------------ *
 * Knowledge Vault — evolved Note model
 * ------------------------------------------------------------------
 * This is a BACKWARD-COMPATIBLE evolution of the original Note schema.
 *  - Same model name ("Note") and same collection ("notes").
 *  - Every original field is preserved exactly.
 *  - Every new field is optional with a default, so existing documents
 *    remain valid and the current /api/notes contract is unchanged.
 *  - Media uses GridFS/disk refs (S3 removed); legacy url-based
 *    attachments still validate as `storage: "external"`.
 * See docs/knowledge-vault/ARCHITECTURE.md for the full design.
 * ------------------------------------------------------------------ */

/* ---- embedded sub-schemas ---- */

// Multi-format body. `plain` is the source of truth for search + AI and is
// kept mirrored with the legacy `content` field.
const RichBodySchema = new Schema(
  {
    format: { type: String, enum: ["richtext", "markdown", "html", "plain"], default: "plain" },
    richText: { type: Schema.Types.Mixed, default: null }, // editor JSON (TipTap/Slate/ProseMirror)
    markdown: { type: String, default: "" },
    html: { type: String, default: "" }, // sanitize on write at the service layer
    plain: { type: String, default: "" },
  },
  { _id: false }
);

// Superset of the original attachment shape. `kind`/`storage` default so old
// attachments (fileName/url/mimeType/size) stay valid without a backfill.
const MediaRefSchema = new Schema(
  {
    kind: { type: String, enum: ["image", "file", "video", "voice", "link"], default: "file" },
    storage: { type: String, enum: ["gridfs", "disk", "external"], default: "external" },
    fileId: { type: Schema.Types.ObjectId, default: null }, // GridFS _id when storage=gridfs
    path: { type: String, default: "" }, // server path when storage=disk
    url: { type: String, default: "" }, // legacy/external link
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 }, // audio/video
    transcript: { type: String, default: "" }, // voice → text (feeds search)
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: true, timestamps: true }
);

const AiBlockSchema = new Schema(
  {
    summary: { type: String, default: "" },
    keywords: { type: [String], default: [] },
    classification: { type: String, default: "" },
    confidence: { type: Number, default: 0 }, // 0..1
    suggestedFolderId: { type: Schema.Types.ObjectId, ref: "kv_folders", default: null },
    suggestedTags: { type: [String], default: [] },
    language: { type: String, default: "" },
    model: { type: String, default: "" }, // provenance
    generatedAt: { type: Date, default: null },
    contentHash: { type: String, default: "" }, // hash at generation → staleness detection
  },
  { _id: false }
);

const ReferencesSchema = new Schema(
  {
    projects: [{ type: Schema.Types.ObjectId, ref: "Project" }],
    tasks: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    employees: [{ type: Schema.Types.ObjectId, ref: "User" }],
    customers: [{ type: Schema.Types.ObjectId, ref: "CrmCompany" }],
    vendors: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
  },
  { _id: false }
);

/* ---- main note ---- */

const NoteSchema = new Schema(
  {
    // ===== EXISTING FIELDS — unchanged =====
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "" },
    content: { type: String, default: "" }, // legacy body; mirrored with body.plain
    color: { type: String, default: "#ffffff" },
    isPinned: { type: Boolean, default: false },
    isFavorite: { type: Boolean, default: false },
    folder: { type: String, default: "" }, // legacy string folder (coexists with folderId)
    tags: [{ type: String }],
    actionItems: [
      {
        text: { type: String, default: "" },
        completed: { type: Boolean, default: false },
      },
    ],
    notesList: [{ type: String }],
    attachments: { type: [MediaRefSchema], default: [] },
    lastOpenedAt: { type: Date, default: Date.now },

    // ===== NEW: identity & tenancy =====
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true }, // alias of userId

    // ===== NEW: rich, multi-format body =====
    body: { type: RichBodySchema, default: () => ({}) },

    // ===== NEW: classification =====
    folderId: { type: Schema.Types.ObjectId, ref: "kv_folders", default: null, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "kv_categories", default: null, index: true },
    tagIds: [{ type: Schema.Types.ObjectId, ref: "kv_tags" }],

    // ===== NEW: state & flags =====
    status: { type: String, enum: ["draft", "active", "archived", "published"], default: "active", index: true },
    priority: { type: String, enum: ["low", "normal", "high", "critical"], default: "normal", index: true },
    visibility: { type: String, enum: ["private", "org", "shared", "public"], default: "private", index: true },
    isImportant: { type: Boolean, default: false },

    // ===== NEW: soft delete =====
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // ===== NEW: extensibility =====
    customMetadata: { type: Schema.Types.Mixed, default: {} },

    // ===== NEW: AI =====
    ai: { type: AiBlockSchema, default: () => ({}) },

    // ===== NEW: graph & cross-refs =====
    relatedNotes: [{ type: Schema.Types.ObjectId, ref: "Note" }],
    references: { type: ReferencesSchema, default: () => ({}) },

    // ===== NEW: search & dedupe =====
    searchText: { type: String, default: "" }, // title + body.plain + tags + AI summary
    contentHash: { type: String, default: "", index: true }, // sha256 of normalized body → duplicate detection

    // ===== NEW: optimistic versioning (managed by the v2 NoteService) =====
    version: { type: Number, default: 1 },
  },
  { timestamps: true, minimize: false }
);

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

// Runs on create()/save(). Keeps legacy `content` and new `body.plain` in sync,
// backfills ownerId, and maintains searchText + contentHash.
NoteSchema.pre("save", function (next) {
  if (!this.ownerId && this.userId) this.ownerId = this.userId;

  if (this.body && this.body.plain) {
    this.content = this.body.plain;
  } else if (this.content) {
    if (!this.body) this.body = {};
    this.body.plain = this.content;
  }

  const plain = (this.body && this.body.plain) || this.content || "";
  this.searchText = [this.title, plain, (this.tags || []).join(" "), this.ai && this.ai.summary]
    .filter(Boolean)
    .join(" \n ");
  this.contentHash = crypto
    .createHash("sha256")
    .update(`${this.title || ""}\n${plain}`.trim().toLowerCase())
    .digest("hex");

  next();
});

/* ------------------------------------------------------------------ *
 * Indexes
 * ------------------------------------------------------------------
 * NOTE: keep the ORIGINAL text index definition below untouched — MongoDB
 * allows only one text index per collection, so changing it requires a manual
 * migration (drop old, create new on `searchText`). See ARCHITECTURE.md §8/§11.
 * In production prefer building indexes via a migration with { background: true }
 * / rolling builds rather than relying on autoIndex against a large collection.
 * ------------------------------------------------------------------ */

// Original text index — preserved as-is (title + content already maintained).
NoteSchema.index({ userId: 1, title: "text", content: "text" });

// Common list/browse paths (Equality, Sort, Range ordering).
NoteSchema.index({ organizationId: 1, isDeleted: 1, updatedAt: -1 });
NoteSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });
NoteSchema.index({ organizationId: 1, folderId: 1, isDeleted: 1, updatedAt: -1 });
NoteSchema.index({ organizationId: 1, categoryId: 1, isDeleted: 1, updatedAt: -1 });
NoteSchema.index({ organizationId: 1, tagIds: 1, updatedAt: -1 });
// Pinned/favorite fast lane — partial index only stores the "true" rows.
NoteSchema.index({ ownerId: 1, isPinned: 1 }, { partialFilterExpression: { isPinned: true } });
NoteSchema.index({ ownerId: 1, isFavorite: 1 }, { partialFilterExpression: { isFavorite: true } });

// Guard against OverwriteModelError on hot-reload; keep name "Note"/collection "notes".
module.exports = mongoose.models.Note || mongoose.model("Note", NoteSchema);
