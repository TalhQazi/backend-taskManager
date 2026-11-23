/* ------------------------------------------------------------------ *
 * BaseRepository — the single place org-isolation + soft-delete live.
 * ------------------------------------------------------------------
 * Every KV query funnels through scope(ctx, filter) so a handler can
 * never forget the tenant boundary or accidentally return deleted rows.
 * ctx = { userId, organizationId, role }
 * ------------------------------------------------------------------ */
const PRIVILEGED = new Set(["super-admin"]);

class BaseRepository {
  constructor(model, { softDelete = true, orgScoped = true } = {}) {
    this.model = model;
    this.softDelete = softDelete;
    this.orgScoped = orgScoped;
  }

  /** Merge caller filter with mandatory tenant + soft-delete guards. */
  scope(ctx = {}, filter = {}) {
    const guard = {};
    if (this.softDelete) guard.isDeleted = { $ne: true };
    if (this.orgScoped && ctx.organizationId && !PRIVILEGED.has(ctx.role)) {
      guard.organizationId = ctx.organizationId;
    }
    return { ...guard, ...filter };
  }

  find(ctx, filter = {}, opts = {}) {
    let q = this.model.find(this.scope(ctx, filter));
    if (opts.sort) q = q.sort(opts.sort);
    if (typeof opts.skip === "number") q = q.skip(opts.skip);
    if (typeof opts.limit === "number") q = q.limit(opts.limit);
    if (opts.select) q = q.select(opts.select);
    if (opts.lean !== false) q = q.lean();
    return q.exec();
  }

  count(ctx, filter = {}) {
    return this.model.countDocuments(this.scope(ctx, filter));
  }

  findById(ctx, id, opts = {}) {
    let q = this.model.findOne(this.scope(ctx, { _id: id }));
    if (opts.select) q = q.select(opts.select);
    if (opts.lean !== false) q = q.lean();
    return q.exec();
  }

  /** Unscoped fetch by id — callers must authorize via PermissionService. */
  rawById(id) {
    return this.model.findById(id).exec();
  }

  create(doc) {
    return this.model.create(doc);
  }

  updateById(ctx, id, update, opts = {}) {
    return this.model
      .findOneAndUpdate(this.scope(ctx, { _id: id }), update, { new: true, ...opts })
      .exec();
  }

  /** Soft delete when enabled, hard delete otherwise. */
  async remove(ctx, id, actorId) {
    if (this.softDelete) {
      return this.model
        .findOneAndUpdate(
          this.scope(ctx, { _id: id }),
          { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId || null } },
          { new: true }
        )
        .exec();
    }
    return this.model.findOneAndDelete(this.scope(ctx, { _id: id })).exec();
  }

  aggregate(pipeline) {
    return this.model.aggregate(pipeline).exec();
  }
}

module.exports = BaseRepository;
