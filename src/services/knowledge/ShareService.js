/* Sharing / ACL for notes. */
const crypto = require("crypto");
const models = require("../../models/knowledge");
const { noteRepository } = require("../../repositories/knowledge");
const PermissionService = require("./PermissionService");
const { AuditService, ActivityService } = require("./governance");

const ShareService = {
  async list(ctx, noteId) {
    const note = await noteRepository.rawById(noteId);
    if (!note || !(await PermissionService.can(ctx, "read", note))) return null;
    return models.NoteShare.find({ noteId }).lean();
  },

  async create(ctx, noteId, { principalType, principalId = null, roleName = null, access = "viewer", expiresAt = null }) {
    const note = await noteRepository.rawById(noteId);
    if (!note) return null;
    if (!(await PermissionService.can(ctx, "share", note))) return { forbidden: true };

    const doc = {
      noteId,
      organizationId: note.organizationId || null,
      principalType,
      principalId,
      roleName,
      access,
      expiresAt,
      createdBy: ctx.userId,
    };
    if (principalType === "link") doc.linkToken = crypto.randomBytes(16).toString("hex");

    const share = await models.NoteShare.create(doc);
    // Flip visibility so the note is discoverable as shared.
    if (note.visibility === "private") {
      note.visibility = "shared";
      await note.save();
    }
    ActivityService.record(ctx, { verb: "shared", resourceId: noteId, summary: note.title });
    AuditService.record(ctx, { action: "note.share", resourceId: noteId, after: doc });
    return share;
  },

  async revoke(ctx, shareId) {
    const share = await models.NoteShare.findById(shareId);
    if (!share) return null;
    const note = await noteRepository.rawById(share.noteId);
    if (note && !(await PermissionService.can(ctx, "share", note))) return { forbidden: true };
    await share.deleteOne();
    AuditService.record(ctx, { action: "note.share.revoke", resourceId: share.noteId, before: share.toObject() });
    return { ok: true };
  },
};

module.exports = ShareService;
