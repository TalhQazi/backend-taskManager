/* Folder (hierarchical, materialized path), Category, and Tag services. */
const models = require("../../models/knowledge");
const { folderRepository, categoryRepository, tagRepository } = require("../../repositories/knowledge");

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const FolderService = {
  list(ctx) {
    return folderRepository.find(ctx, {}, { sort: { path: 1 } });
  },
  async create(ctx, { name, parentId = null, color = "", icon = "", visibility = "private" }) {
    let path = "/";
    let depth = 0;
    if (parentId) {
      const parent = await folderRepository.rawById(parentId);
      if (parent) {
        path = `${parent.path}${parent.name}/`;
        depth = (parent.depth || 0) + 1;
      }
    }
    return folderRepository.create({
      organizationId: ctx.organizationId || null,
      ownerId: ctx.userId,
      name,
      parentId,
      path,
      depth,
      color,
      icon,
      visibility,
    });
  },
  update(ctx, id, patch) {
    return folderRepository.updateById(ctx, id, { $set: patch });
  },
  remove(ctx, id) {
    return folderRepository.remove(ctx, id, ctx.userId);
  },
  /** Subtree via materialized path — no recursion. */
  subtree(ctx, folder) {
    return folderRepository.find(ctx, { path: new RegExp(`^${folder.path}${folder.name}/`) });
  },
};

const CategoryService = {
  list(ctx) {
    return categoryRepository.find(ctx, {}, { sort: { name: 1 } });
  },
  create(ctx, { name, description = "", color = "" }) {
    return categoryRepository.create({
      organizationId: ctx.organizationId || null,
      ownerId: ctx.userId,
      name,
      description,
      color,
    });
  },
  update(ctx, id, patch) {
    return categoryRepository.updateById(ctx, id, { $set: patch });
  },
  remove(ctx, id) {
    return categoryRepository.remove(ctx, id, ctx.userId);
  },
};

const TagService = {
  list(ctx, { limit = 200 } = {}) {
    return tagRepository.find(ctx, {}, { sort: { usageCount: -1 }, limit });
  },
  /** Idempotent upsert; bumps usageCount. */
  async ensure(ctx, name) {
    const slug = slugify(name);
    if (!slug) return null;
    return models.Tag.findOneAndUpdate(
      { organizationId: ctx.organizationId || null, slug },
      {
        $setOnInsert: { organizationId: ctx.organizationId || null, name, slug, source: "user" },
        $inc: { usageCount: 1 },
        $set: { lastUsedAt: new Date() },
      },
      { upsert: true, new: true }
    );
  },
};

module.exports = { FolderService, CategoryService, TagService, slugify };
