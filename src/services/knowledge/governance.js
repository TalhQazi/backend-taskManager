/* Audit, Activity feed, and Undo services. All fire-and-forget safe: a logging
 * failure must never break the primary operation. */
const models = require("../../models/knowledge");

const AuditService = {
  async record(ctx, { action, resourceType = "note", resourceId, before = null, after = null }) {
    try {
      await models.AuditLog.create({
        organizationId: ctx.organizationId || null,
        actorId: ctx.userId || null,
        actorRole: ctx.role || "",
        action,
        resourceType,
        resourceId: resourceId || null,
        before,
        after,
        ip: ctx.ip || "",
        userAgent: ctx.userAgent || "",
        requestId: ctx.requestId || "",
      });
    } catch (err) {
      console.error("[KV AuditService]", err.message);
    }
  },
  list(ctx, { limit = 50, skip = 0 } = {}) {
    return models.AuditLog.find({ organizationId: ctx.organizationId || null })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  },
};

const ActivityService = {
  async record(ctx, { verb, resourceType = "note", resourceId, summary = "", meta = {} }) {
    try {
      await models.ActivityHistory.create({
        organizationId: ctx.organizationId || null,
        actorId: ctx.userId || null,
        verb,
        resourceType,
        resourceId: resourceId || null,
        summary,
        meta,
      });
    } catch (err) {
      console.error("[KV ActivityService]", err.message);
    }
  },
  feed(ctx, { limit = 50, skip = 0 } = {}) {
    const filter = ctx.organizationId ? { organizationId: ctx.organizationId } : { actorId: ctx.userId };
    return models.ActivityHistory.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  },
};

const UndoService = {
  /** Push a reversible action onto the user's undo stack. */
  async push(ctx, { action, resourceType = "note", resourceId, inverse }) {
    try {
      return await models.UndoHistory.create({
        userId: ctx.userId,
        organizationId: ctx.organizationId || null,
        action,
        resourceType,
        resourceId: resourceId || null,
        inverse: inverse || {},
      });
    } catch (err) {
      console.error("[KV UndoService.push]", err.message);
      return null;
    }
  },
  /** Return the inverse patch for a given undo entry (application is done by the caller's service). */
  async pop(ctx, undoId) {
    const entry = await models.UndoHistory.findOne({ _id: undoId, userId: ctx.userId, undoneAt: null });
    if (!entry) return null;
    entry.undoneAt = new Date();
    await entry.save();
    return entry;
  },
};

module.exports = { AuditService, ActivityService, UndoService };
