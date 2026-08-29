/* ------------------------------------------------------------------ *
 * NoteService — CRUD + optimistic versioning + soft delete, with audit,
 * activity and undo wired in. This is the code path both v2 and (via an
 * adapter) v1 use, so behavior never drifts between surfaces.
 * ------------------------------------------------------------------ */
const models = require("../../models/knowledge");
const { noteRepository } = require("../../repositories/knowledge");
const PermissionService = require("./PermissionService");
const { AuditService, ActivityService, UndoService } = require("./governance");

function paginate(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

const SORT_MAP = {
  updated: { updatedAt: -1 },
  created: { createdAt: -1 },
  title: { title: 1 },
  priority: { priority: -1, updatedAt: -1 },
};

const NoteService = {
  async list(ctx, query = {}) {
    const { page, limit, skip } = paginate(query);
    const sharedIds = await PermissionService.sharedNoteIds(ctx);
    const filter = { ...noteRepository.visibilityFilter(ctx, sharedIds) };

    if (query.folderId) filter.folderId = query.folderId;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.visibility) filter.visibility = query.visibility;
    if (query.tag) filter.tags = query.tag;
    if (query.pinned === "true") filter.isPinned = true;
    if (query.favorite === "true") filter.isFavorite = true;
    if (query.important === "true") filter.isImportant = true;
    if (query.q) filter.$text = { $search: String(query.q) };

    const sort = SORT_MAP[query.sort] || { isPinned: -1, updatedAt: -1 };
    const [items, total] = await Promise.all([
      noteRepository.find(ctx, filter, {
        sort,
        skip,
        limit,
        select: "title content color isPinned isFavorite isImportant folder folderId tags status priority visibility updatedAt createdAt ai heroImage actionItems notesList attachments",
      }),
      noteRepository.count(ctx, filter),
    ]);
    return { items: items.map((n) => ({ ...n, id: n._id })), page, limit, total, totalPages: Math.ceil(total / limit) };
  },

  async get(ctx, id) {
    const note = await noteRepository.rawById(id);
    if (!note || note.isDeleted) return null;
    if (!(await PermissionService.can(ctx, "read", note))) return { forbidden: true };
    return { ...note.toObject(), id: note._id };
  },

  async create(ctx, dto) {
    const note = await noteRepository.create({
      userId: ctx.userId,
      ownerId: ctx.userId,
      organizationId: ctx.organizationId || null,
      title: dto.title || "",
      content: dto.content || (dto.body && dto.body.plain) || "",
      body: dto.body || {},
      color: dto.color || "#ffffff",
      folder: dto.folder || "",
      folderId: dto.folderId || null,
      categoryId: dto.categoryId || null,
      tags: dto.tags || [],
      tagIds: dto.tagIds || [],
      status: dto.status || "active",
      priority: dto.priority || "normal",
      visibility: dto.visibility || "private",
      isImportant: !!dto.isImportant,
      references: dto.references || {},
      customMetadata: dto.customMetadata || {},
    });
    await this._version(note, ctx, "created");
    ActivityService.record(ctx, { verb: "created", resourceId: note._id, summary: note.title });
    AuditService.record(ctx, { action: "note.create", resourceId: note._id, after: note.toObject() });
    return { ...note.toObject(), id: note._id };
  },

  async update(ctx, id, dto) {
    const note = await noteRepository.rawById(id);
    if (!note || note.isDeleted) return null;
    if (!(await PermissionService.can(ctx, "update", note))) return { forbidden: true };

    // Optimistic concurrency: client may pass expectedVersion.
    if (dto.expectedVersion != null && Number(dto.expectedVersion) !== note.version) {
      return { conflict: true, currentVersion: note.version };
    }

    const before = note.toObject();
    const undoInverse = {};
    const editable = [
      "title", "content", "body", "color", "folder", "folderId", "categoryId",
      "tags", "tagIds", "status", "priority", "visibility", "isImportant",
      "isPinned", "isFavorite", "references", "customMetadata",
    ];
    for (const f of editable) {
      if (dto[f] !== undefined) {
        undoInverse[f] = before[f];
        note[f] = dto[f];
      }
    }
    note.version = (note.version || 1) + 1;
    await note.save(); // pre-save hook keeps content/body/searchText/hash in sync

    await this._version(note, ctx, dto.reason || "updated");
    await UndoService.push(ctx, { action: "note.update", resourceId: note._id, inverse: undoInverse });
    ActivityService.record(ctx, { verb: "edited", resourceId: note._id, summary: note.title });
    AuditService.record(ctx, { action: "note.update", resourceId: note._id, before, after: note.toObject() });
    return { ...note.toObject(), id: note._id };
  },

  async remove(ctx, id) {
    const note = await noteRepository.rawById(id);
    if (!note || note.isDeleted) return null;
    if (!(await PermissionService.can(ctx, "delete", note))) return { forbidden: true };
    const updated = await noteRepository.remove(ctx, id, ctx.userId);
    await UndoService.push(ctx, { action: "note.delete", resourceId: id, inverse: { isDeleted: false, deletedAt: null } });
    ActivityService.record(ctx, { verb: "deleted", resourceId: id, summary: note.title });
    AuditService.record(ctx, { action: "note.delete", resourceId: id, before: note.toObject() });
    return updated;
  },

  async restore(ctx, id) {
    const note = await noteRepository.rawById(id);
    if (!note) return null;
    if (!(await PermissionService.can(ctx, "update", note))) return { forbidden: true };
    note.isDeleted = false;
    note.deletedAt = null;
    note.deletedBy = null;
    await note.save();
    ActivityService.record(ctx, { verb: "restored", resourceId: id, summary: note.title });
    return { ...note.toObject(), id: note._id };
  },

  async versions(ctx, id) {
    const note = await noteRepository.rawById(id);
    if (!note || !(await PermissionService.can(ctx, "read", note))) return null;
    return models.NoteVersion.find({ noteId: id }).sort({ version: -1 }).limit(100).lean();
  },

  async restoreVersion(ctx, id, version) {
    const note = await noteRepository.rawById(id);
    if (!note || !(await PermissionService.can(ctx, "update", note))) return { forbidden: true };
    const snap = await models.NoteVersion.findOne({ noteId: id, version }).lean();
    if (!snap) return null;
    Object.assign(note, snap.snapshot || {});
    note.version = (note.version || 1) + 1;
    await note.save();
    await this._version(note, ctx, `restored v${version}`);
    return { ...note.toObject(), id: note._id };
  },

  async _version(note, ctx, reason) {
    try {
      await models.NoteVersion.create({
        noteId: note._id,
        organizationId: note.organizationId || null,
        version: note.version || 1,
        snapshot: {
          title: note.title,
          content: note.content,
          body: note.body,
          tags: note.tags,
          tagIds: note.tagIds,
          folderId: note.folderId,
          categoryId: note.categoryId,
          status: note.status,
          priority: note.priority,
          visibility: note.visibility,
        },
        editorId: ctx.userId,
        reason,
      });
    } catch (err) {
      console.error("[KV NoteService._version]", err.message);
    }
  },
};

module.exports = NoteService;
