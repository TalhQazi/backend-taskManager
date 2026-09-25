/* ------------------------------------------------------------------ *
 * Knowledge Vault — new collections (barrel)
 * ------------------------------------------------------------------
 * All new KV collections are prefixed `kv_` so they group together and
 * never collide with existing collections. The evolved Note model lives
 * in ../Note.js (collection "notes"). See docs/knowledge-vault/ARCHITECTURE.md.
 * ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Guard so hot-reload / repeated requires don't throw OverwriteModelError.
const model = (name, schema, collection) =>
  mongoose.models[name] || mongoose.model(name, schema, collection);

/* ----------------------------- Taxonomy ----------------------------- */

const FolderSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "kv_folders", default: null, index: true },
    path: { type: String, default: "/", index: true }, // materialized path e.g. "/root/child/"
    depth: { type: Number, default: 0 },
    color: { type: String, default: "" },
    icon: { type: String, default: "" },
    visibility: { type: String, enum: ["private", "org", "shared"], default: "private" },
    noteCount: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
FolderSchema.index({ organizationId: 1, path: 1 });

const CategorySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    color: { type: String, default: "" },
    isSystem: { type: Boolean, default: false },
    aiSynonyms: { type: [String], default: [] },
    noteCount: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
CategorySchema.index({ organizationId: 1, name: 1 }, { unique: true });

const TagSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    source: { type: String, enum: ["user", "ai"], default: "user" },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
TagSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
TagSchema.index({ organizationId: 1, usageCount: -1 });

/* --------------------------- Note metadata -------------------------- */

const NoteVersionSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    version: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, default: {} }, // full note state at this version
    diff: { type: Schema.Types.Mixed, default: null }, // optional patch
    editorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
NoteVersionSchema.index({ noteId: 1, version: -1 });

const NoteRelationshipSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    from: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    to: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    type: {
      type: String,
      enum: ["related", "duplicate", "references", "supersedes", "derived_from"],
      default: "related",
    },
    weight: { type: Number, default: 0 }, // 0..1 (e.g. cosine similarity)
    source: { type: String, enum: ["user", "ai"], default: "user" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
NoteRelationshipSchema.index({ from: 1, to: 1, type: 1 }, { unique: true });

const NoteShareSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    principalType: { type: String, enum: ["user", "role", "org", "link"], required: true },
    principalId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    roleName: { type: String, default: null },
    linkToken: { type: String, default: null },
    access: { type: String, enum: ["viewer", "commenter", "editor", "owner"], default: "viewer" },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
NoteShareSchema.index({ principalType: 1, principalId: 1 });
NoteShareSchema.index({ linkToken: 1 }, { sparse: true });

const NoteCommentSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "" },
    parentId: { type: Schema.Types.ObjectId, ref: "kv_note_comments", default: null },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    reactions: [{ userId: { type: Schema.Types.ObjectId, ref: "User" }, emoji: String }],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
NoteCommentSchema.index({ noteId: 1, createdAt: 1 });

/* -------------------------------- AI -------------------------------- */

const AiSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    kind: { type: String, enum: ["chat", "voice", "command"], default: "chat" },
    context: {
      noteIds: [{ type: Schema.Types.ObjectId, ref: "Note" }],
      scope: { type: String, enum: ["note", "folder", "org"], default: "org" },
    },
    messages: [
      {
        role: { type: String, enum: ["user", "assistant", "system"] },
        content: String,
        tokens: { type: Number, default: 0 },
        at: { type: Date, default: Date.now },
      },
    ],
    model: { type: String, default: "" },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    // TTL: document auto-purged once expiresAt passes.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);
AiSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AiCommandSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "kv_ai_sessions", default: null, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    command: { type: String, default: "" },
    intent: { type: String, default: "" },
    targetNoteId: { type: Schema.Types.ObjectId, ref: "Note", default: null },
    params: { type: Schema.Types.Mixed, default: {} },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    model: { type: String, default: "" },
    status: { type: String, enum: ["ok", "error"], default: "ok" },
    error: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const AiSuggestionSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    type: {
      type: String,
      enum: ["tag", "folder", "summary", "category", "merge", "link", "keywords"],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: Number, default: 0 },
    status: { type: String, enum: ["pending", "accepted", "rejected", "expired"], default: "pending" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    model: { type: String, default: "" },
  },
  { timestamps: true }
);
AiSuggestionSchema.index({ noteId: 1, status: 1 });
AiSuggestionSchema.index({ organizationId: 1, status: 1 });

const NoteEmbeddingSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    model: { type: String, default: "" },
    dim: { type: Number, default: 0 },
    vector: { type: [Number], default: [] },
    chunk: { index: { type: Number, default: 0 }, text: { type: String, default: "" } },
    contentHash: { type: String, default: "" }, // regenerate only when this changes
  },
  { timestamps: true }
);
NoteEmbeddingSchema.index({ noteId: 1, "chunk.index": 1 });

/* ----------------------------- Governance --------------------------- */

const AuditLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "" },
    action: { type: String, required: true },
    resourceType: { type: String, default: "note" },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    requestId: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

const ActivityHistorySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    verb: { type: String, required: true },
    resourceType: { type: String, default: "note" },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    summary: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ActivityHistorySchema.index({ organizationId: 1, createdAt: -1 });
ActivityHistorySchema.index({ actorId: 1, createdAt: -1 });

const UndoHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    action: { type: String, required: true },
    resourceType: { type: String, default: "note" },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    inverse: { type: Schema.Types.Mixed, default: {} }, // patch that reverts the action
    appliedAt: { type: Date, default: Date.now },
    undoneAt: { type: Date, default: null },
    // TTL: prune the undo stack after 7 days.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);
UndoHistorySchema.index({ userId: 1, createdAt: -1 });
UndoHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PermissionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    principalType: { type: String, enum: ["user", "role"], required: true },
    principalId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    roleName: { type: String, default: null },
    resourceType: { type: String, enum: ["note", "folder", "vault"], default: "vault" },
    resourceId: { type: Schema.Types.ObjectId, default: null }, // null = whole vault
    actions: { type: [String], default: [] }, // ["read","update","delete","share"]
    grantedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
PermissionSchema.index({ principalType: 1, principalId: 1, resourceType: 1, resourceId: 1 });

module.exports = {
  Folder: model("kv_folders", FolderSchema, "kv_folders"),
  Category: model("kv_categories", CategorySchema, "kv_categories"),
  Tag: model("kv_tags", TagSchema, "kv_tags"),
  NoteVersion: model("kv_note_versions", NoteVersionSchema, "kv_note_versions"),
  NoteRelationship: model("kv_note_relationships", NoteRelationshipSchema, "kv_note_relationships"),
  NoteShare: model("kv_note_shares", NoteShareSchema, "kv_note_shares"),
  NoteComment: model("kv_note_comments", NoteCommentSchema, "kv_note_comments"),
  AiSession: model("kv_ai_sessions", AiSessionSchema, "kv_ai_sessions"),
  AiCommand: model("kv_ai_commands", AiCommandSchema, "kv_ai_commands"),
  AiSuggestion: model("kv_ai_suggestions", AiSuggestionSchema, "kv_ai_suggestions"),
  NoteEmbedding: model("kv_note_embeddings", NoteEmbeddingSchema, "kv_note_embeddings"),
  AuditLog: model("kv_audit_logs", AuditLogSchema, "kv_audit_logs"),
  ActivityHistory: model("kv_activity_history", ActivityHistorySchema, "kv_activity_history"),
  UndoHistory: model("kv_undo_history", UndoHistorySchema, "kv_undo_history"),
  Permission: model("kv_permissions", PermissionSchema, "kv_permissions"),
  Note: require("../Note"),
};
