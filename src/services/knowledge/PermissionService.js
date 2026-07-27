/* ------------------------------------------------------------------ *
 * PermissionService — one resolver, four inputs:
 *   org isolation ⊕ role capability ⊕ explicit grants ⊕ share ACL
 * ------------------------------------------------------------------ */
const models = require("../../models/knowledge");

const ACCESS_RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const ACTION_MIN = { read: 1, comment: 2, update: 3, delete: 4, share: 3 };

const PermissionService = {
  isOwner(ctx, note) {
    const owner = String(note.ownerId || note.userId || "");
    return owner && owner === String(ctx.userId);
  },

  roleAllows(ctx, action) {
    const role = ctx.role;
    if (role === "super-admin" || role === "admin") return true;
    if (role === "manager") return action !== "delete"; // managers read/update/share, not force-delete others'
    return false; // employees fall through to ownership/share checks
  },

  /** Highest access level this user has on a note via shares. */
  async shareAccess(ctx, noteId) {
    const shares = await models.NoteShare.find({
      noteId,
      $or: [
        { principalType: "user", principalId: ctx.userId },
        { principalType: "role", roleName: ctx.role },
        { principalType: "org" },
      ],
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }],
    }).lean();
    return shares.reduce((max, s) => Math.max(max, ACCESS_RANK[s.access] || 0), 0);
  },

  async grantAllows(ctx, action, note) {
    const grants = await models.Permission.find({
      $or: [
        { principalType: "user", principalId: ctx.userId },
        { principalType: "role", roleName: ctx.role },
      ],
      resourceType: { $in: ["vault", "note"] },
    }).lean();
    return grants.some(
      (g) =>
        (g.resourceType === "vault" || String(g.resourceId) === String(note._id)) &&
        Array.isArray(g.actions) &&
        g.actions.includes(action)
    );
  },

  /** Central authorization check. Returns boolean. */
  async can(ctx, action, note) {
    if (!note) return false;
    // org isolation (admins exempt)
    if (
      ctx.organizationId &&
      note.organizationId &&
      String(ctx.organizationId) !== String(note.organizationId) &&
      !["super-admin", "admin"].includes(ctx.role)
    ) {
      return false;
    }
    if (this.isOwner(ctx, note)) return true;
    if (this.roleAllows(ctx, action)) return true;

    // public/org visibility grants read
    if (action === "read") {
      if (note.visibility === "public") return true;
      if (note.visibility === "org" && ctx.organizationId && String(ctx.organizationId) === String(note.organizationId))
        return true;
    }

    const needed = ACTION_MIN[action] || 99;
    const viaShare = await this.shareAccess(ctx, note._id);
    if (viaShare >= needed) return true;

    try {
      if (await this.grantAllows(ctx, action, note)) return true;
    } catch {
      /* grants are best-effort */
    }
    return false;
  },

  /** Note ids explicitly shared with this user (for list visibility). */
  async sharedNoteIds(ctx) {
    const shares = await models.NoteShare.find({
      $or: [
        { principalType: "user", principalId: ctx.userId },
        { principalType: "role", roleName: ctx.role },
        { principalType: "org" },
      ],
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }],
    })
      .select("noteId")
      .lean();
    return shares.map((s) => s.noteId);
  },
};

module.exports = PermissionService;
