const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");

const { requireAuth, requireRole } = require("../middleware/auth");
const { uploadToS3, extractS3Key } = require("../lib/s3");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const AssetLibraryFolder = require("../models/AssetLibraryFolder");
const AssetLibraryAsset = require("../models/AssetLibraryAsset");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

function toObjectIdOrNull(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!mongoose.Types.ObjectId.isValid(v)) return null;
  return new mongoose.Types.ObjectId(v);
}

function buildFolderTree(items) {
  const map = new Map();
  const roots = [];

  for (const f of items) {
    map.set(String(f._id), { ...f, id: String(f._id), children: [] });
  }

  for (const f of items) {
    const node = map.get(String(f._id));
    const parentId = f.parentFolderId ? String(f.parentFolderId) : "";
    if (parentId && map.has(parentId)) {
      map.get(parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (arr) => {
    arr.sort((a, b) => {
      const ao = Number(a.sortOrder || 0);
      const bo = Number(b.sortOrder || 0);
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}

const folderCreateSchema = z.object({
  name: z.string().min(1),
  parentFolderId: z.string().optional().nullable(),
  description: z.string().optional().default(""),
  isReadOnly: z.boolean().optional().default(false),
  sortOrder: z.number().optional().default(0),
});

const folderPatchSchema = z.object({
  name: z.string().min(1).optional(),
  parentFolderId: z.string().optional().nullable(),
  description: z.string().optional(),
  isReadOnly: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const assetPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().optional().nullable(),
  status: z.enum(["active", "archived", "deleted"]).optional(),
});

router.get("/folders", requireAuth, async (_req, res, next) => {
  try {
    const items = await AssetLibraryFolder.find({ isArchived: false }).lean();

    const folderIds = items.map((f) => f._id);
    const counts = await AssetLibraryAsset.aggregate([
      { $match: { status: "active", folderId: { $in: folderIds } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), Number(c.count || 0)]));

    const itemsWithCounts = items.map((f) => ({
      ...f,
      assetCount: countMap.get(String(f._id)) || 0,
    }));

    const tree = buildFolderTree(itemsWithCounts);
    res.json({ items: tree });
  } catch (err) {
    next(err);
  }
});

router.post("/folders", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = folderCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const parentFolderId = toObjectIdOrNull(parsed.data.parentFolderId);

    if (parentFolderId) {
      const parent = await AssetLibraryFolder.findById(parentFolderId).lean();
      if (!parent || parent.isArchived) return res.status(404).json({ error: { message: "Parent folder not found" } });
      if (parent.isReadOnly) return res.status(400).json({ error: { message: "Parent folder is read-only" } });
    }

    const createdBy = String(req.user?.sub || "");

    const doc = await AssetLibraryFolder.create({
      name: parsed.data.name,
      parentFolderId,
      description: parsed.data.description,
      isReadOnly: parsed.data.isReadOnly,
      sortOrder: parsed.data.sortOrder,
      createdBy,
    });

    res.json({ item: { ...doc.toObject(), id: String(doc._id) } });
  } catch (err) {
    next(err);
  }
});

router.patch("/folders/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const folderId = toObjectIdOrNull(req.params.id);
    if (!folderId) return res.status(400).json({ error: { message: "Invalid folder id" } });

    const parsed = folderPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const patch = { ...parsed.data };

    if (Object.prototype.hasOwnProperty.call(patch, "parentFolderId")) {
      const nextParent = toObjectIdOrNull(patch.parentFolderId);
      patch.parentFolderId = nextParent;
      if (nextParent && String(nextParent) === String(folderId)) {
        return res.status(400).json({ error: { message: "Folder cannot be its own parent" } });
      }
      if (nextParent) {
        const parent = await AssetLibraryFolder.findById(nextParent).lean();
        if (!parent || parent.isArchived) return res.status(404).json({ error: { message: "Parent folder not found" } });
        if (parent.isReadOnly) return res.status(400).json({ error: { message: "Parent folder is read-only" } });
      }
    }

    const updated = await AssetLibraryFolder.findByIdAndUpdate(folderId, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Folder not found" } });

    res.json({ item: { ...updated, id: String(updated._id) } });
  } catch (err) {
    next(err);
  }
});

router.delete("/folders/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const folderId = toObjectIdOrNull(req.params.id);
    if (!folderId) return res.status(400).json({ error: { message: "Invalid folder id" } });

    const updated = await AssetLibraryFolder.findByIdAndUpdate(
      folderId,
      { $set: { isArchived: true } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: { message: "Folder not found" } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/assets", requireAuth, async (req, res, next) => {
  try {
    const folderId = toObjectIdOrNull(req.query.folderId);
    const q = String(req.query.q || "").trim();

    const type = String(req.query.type || "").trim().toLowerCase();
    const sort = String(req.query.sort || "newest").trim().toLowerCase();
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { status: "active" };
    if (folderId) filter.folderId = folderId;

    if (type === "image") {
      filter.mimeType = { $regex: /^image\//i };
    } else if (type === "pdf") {
      filter.mimeType = "application/pdf";
    }

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: rx }, { originalFilename: rx }, { description: rx }, { tags: rx }];
    }

    let sortSpec = { createdAt: -1 };
    if (sort === "oldest") sortSpec = { createdAt: 1 };
    if (sort === "az") sortSpec = { originalFilename: 1 };
    if (sort === "za") sortSpec = { originalFilename: -1 };
    if (sort === "size-asc") sortSpec = { sizeBytes: 1 };
    if (sort === "size-desc") sortSpec = { sizeBytes: -1 };

    const [total, docs] = await Promise.all([
      AssetLibraryAsset.countDocuments(filter),
      AssetLibraryAsset.find(filter).sort(sortSpec).skip(skip).limit(limit).lean(),
    ]);

    const items = docs.map((a) => ({
      ...a,
      id: String(a._id),
      urlThumbnail: a.urlOriginal || a.attachment?.url || "",
      urlPreview: a.urlOriginal || a.attachment?.url || "",
      attachment: a.attachment || {
        fileName: a.originalFilename || "",
        url: a.urlOriginal || "",
        mimeType: a.mimeType || "",
        size: a.sizeBytes || 0
      }
    }));
    console.log("[asset-library] Returning items:", items.length, "Total:", total);
    console.log("[asset-library] First item URL:", items[0]?.urlThumbnail, items[0]?.attachment?.url);
    res.json(paginatedResponse(items, total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.patch("/assets/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const assetId = toObjectIdOrNull(req.params.id);
    if (!assetId) return res.status(400).json({ error: { message: "Invalid asset id" } });

    const parsed = assetPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const patch = { ...parsed.data };

    if (Object.prototype.hasOwnProperty.call(patch, "folderId")) {
      const nextFolderId = toObjectIdOrNull(patch.folderId);
      patch.folderId = nextFolderId;

      if (nextFolderId) {
        const folder = await AssetLibraryFolder.findById(nextFolderId).lean();
        if (!folder || folder.isArchived) return res.status(404).json({ error: { message: "Folder not found" } });
        if (folder.isReadOnly) return res.status(400).json({ error: { message: "Folder is read-only" } });
      }
    }

    const updated = await AssetLibraryAsset.findOneAndUpdate(
      { _id: assetId },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: { message: "Asset not found" } });

    res.json({ item: { ...updated, id: String(updated._id) } });
  } catch (err) {
    next(err);
  }
});

router.delete("/assets/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const assetId = toObjectIdOrNull(req.params.id);
    if (!assetId) return res.status(400).json({ error: { message: "Invalid asset id" } });

    const updated = await AssetLibraryAsset.findOneAndUpdate(
      { _id: assetId },
      { $set: { status: "deleted" } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: { message: "Asset not found" } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/assets/upload",
  requireAuth,
  requireRole(["super-admin", "admin"]),
  upload.array("files", 20),
  async (req, res, next) => {
    try {
      const folderId = toObjectIdOrNull(req.body.folderId);
      if (req.body.folderId && !folderId) {
        return res.status(400).json({ error: { message: "Invalid folderId" } });
      }

      if (folderId) {
        const folder = await AssetLibraryFolder.findById(folderId).lean();
        if (!folder || folder.isArchived) return res.status(404).json({ error: { message: "Folder not found" } });
        if (folder.isReadOnly) return res.status(400).json({ error: { message: "Folder is read-only" } });
      }

      const files = req.files || [];
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: { message: "No files uploaded" } });
      }

      const allowed = new Set([
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/svg+xml",
        "application/pdf",
      ]);

      const uploadedBy = String(req.user?.sub || "");

      const created = [];

      for (const f of files) {
        const mimeType = String(f.mimetype || "");
        if (!allowed.has(mimeType)) {
          return res.status(400).json({ error: { message: `Unsupported file type: ${mimeType}` } });
        }

        const originalFilename = String(f.originalname || "");
        const ext = path.extname(originalFilename).replace(".", "").toLowerCase();

        let urlOriginal = "";
        try {
          urlOriginal = await uploadToS3(f.buffer, originalFilename, mimeType, "asset-library");
        } catch (err) {
          console.error("[asset-library] uploadToS3 failed:", err);
          return res.status(500).json({ error: { message: `Upload failed: ${String(err?.message || err)}` } });
        }

        const s3KeyOriginal = extractS3Key(urlOriginal) || "";

        const doc = await AssetLibraryAsset.create({
          folderId,
          title: "",
          description: "",
          tags: [],
          originalFilename,
          mimeType,
          extension: ext,
          sizeBytes: Number(f.size || 0),
          s3KeyOriginal,
          urlOriginal,
          status: "active",
          uploadedBy,
          attachment: {
            fileName: originalFilename,
            url: urlOriginal,
            mimeType,
            size: Number(f.size || 0),
          },
        });

        created.push({ ...doc.toObject(), id: String(doc._id) });
      }

      res.json({ items: created });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/assets/:id/download", requireAuth, async (req, res, next) => {
  try {
    const assetId = toObjectIdOrNull(req.params.id);
    if (!assetId) return res.status(400).json({ error: { message: "Invalid asset id" } });

    const asset = await AssetLibraryAsset.findById(assetId).lean();
    if (!asset || asset.status !== "active") return res.status(404).json({ error: { message: "Asset not found" } });

    const key = asset.s3KeyOriginal || "";
    if (!key) return res.status(400).json({ error: { message: "Missing asset key" } });

    const proxiedUrl = `/api/s3-proxy/${key}`;
    const fileName = asset.originalFilename || asset.title || "asset";

    res.json({ url: proxiedUrl, fileName });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
