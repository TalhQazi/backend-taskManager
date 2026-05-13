const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const { z } = require("zod");

const { requireAuth, requireRole } = require("../middleware/auth");
const { uploadToS3, deleteFromS3 } = require("../lib/s3");
const Meme = require("../models/Meme");
const UserMemeHistory = require("../models/UserMemeHistory");
const UserMemeState = require("../models/UserMemeState");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 }, // 500KB max
});

function toObjectIdOrNull(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!mongoose.Types.ObjectId.isValid(v)) return null;
  return new mongoose.Types.ObjectId(v);
}

function getCdnUrlIfConfigured(s3Url) {
  const cdnBase = String(process.env.MEME_CDN_BASE_URL || process.env.CDN_BASE_URL || "").trim();
  if (!cdnBase) return s3Url;
  // Expect S3 key after the last amazonaws.com/
  const match = String(s3Url || "").match(/amazonaws\.com\/(.+)$/);
  if (!match) return s3Url;
  const key = match[1];
  return `${cdnBase.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

async function pickNextMemeForUser(userId) {
  // Exclude the last 5 viewed memes
  const recent = await UserMemeHistory.find({ userId })
    .sort({ viewedAt: -1 })
    .limit(5)
    .select("memeId")
    .lean();

  const excludeIds = recent.map((r) => r.memeId).filter(Boolean);

  const match = { isActive: true };
  if (excludeIds.length > 0) {
    match._id = { $nin: excludeIds };
  }

  const picked = await Meme.aggregate([{ $match: match }, { $sample: { size: 1 } }]);
  if (picked && picked.length > 0) return picked[0];

  // Fallback: if everything excluded (small pool), sample from all active
  const any = await Meme.aggregate([{ $match: { isActive: true } }, { $sample: { size: 1 } }]);
  return any && any.length > 0 ? any[0] : null;
}

// Public (auth) API
router.get("/next", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const meme = await pickNextMemeForUser(userId);
    if (!meme) {
      return res.status(404).json({ error: { message: "No active memes available" } });
    }

    return res.json({
      id: String(meme._id),
      imageUrl: meme.imageUrl,
      caption: meme.caption || "",
      category: meme.category || "general",
    });
  } catch (err) {
    return next(err);
  }
});

const logSchema = z.object({
  memeId: z.string().min(1),
  timestamp: z.union([z.string().datetime().optional(), z.number().optional(), z.null()]).optional(),
});

router.post("/log", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const parsed = logSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const memeId = toObjectIdOrNull(parsed.data.memeId);
    if (!memeId) return res.status(400).json({ error: { message: "Invalid memeId" } });

    const clientTsRaw = parsed.data.timestamp;
    const clientTimestamp =
      typeof clientTsRaw === "number"
        ? new Date(clientTsRaw)
        : typeof clientTsRaw === "string"
          ? new Date(clientTsRaw)
          : null;

    const viewedAt = new Date();

    await UserMemeHistory.create({
      userId,
      memeId,
      viewedAt,
      clientTimestamp: clientTimestamp && !Number.isNaN(clientTimestamp.getTime()) ? clientTimestamp : null,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// Multi-device sync state (auth) API
router.get("/state", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const doc = await UserMemeState.findOne({ userId }).lean();
    return res.json({
      lastMemeTimestamp: doc?.lastMemeTimestamp ? new Date(doc.lastMemeTimestamp).getTime() : null,
      nextMemeTimestamp: doc?.nextMemeTimestamp ? new Date(doc.nextMemeTimestamp).getTime() : null,
    });
  } catch (err) {
    return next(err);
  }
});

const stateSchema = z.object({
  lastMemeTimestamp: z.number().nullable().optional(),
  nextMemeTimestamp: z.number().nullable().optional(),
});

router.post("/state", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const parsed = stateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const last =
      typeof parsed.data.lastMemeTimestamp === "number" && Number.isFinite(parsed.data.lastMemeTimestamp)
        ? new Date(parsed.data.lastMemeTimestamp)
        : null;
    const nextTs =
      typeof parsed.data.nextMemeTimestamp === "number" && Number.isFinite(parsed.data.nextMemeTimestamp)
        ? new Date(parsed.data.nextMemeTimestamp)
        : null;

    const updated = await UserMemeState.findOneAndUpdate(
      { userId },
      { $set: { lastMemeTimestamp: last, nextMemeTimestamp: nextTs } },
      { upsert: true, new: true }
    ).lean();

    return res.json({
      ok: true,
      lastMemeTimestamp: updated?.lastMemeTimestamp ? new Date(updated.lastMemeTimestamp).getTime() : null,
      nextMemeTimestamp: updated?.nextMemeTimestamp ? new Date(updated.nextMemeTimestamp).getTime() : null,
    });
  } catch (err) {
    return next(err);
  }
});

// Admin APIs
router.get("/admin/list", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const items = await Meme.find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.json({
      items: items.map((m) => ({
        ...m,
        id: String(m._id),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/stats", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const [totalMemes, activeMemes, totalViews, top] = await Promise.all([
      Meme.countDocuments({}),
      Meme.countDocuments({ isActive: true }),
      UserMemeHistory.countDocuments({}),
      UserMemeHistory.aggregate([
        { $group: { _id: "$memeId", views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "memes",
            localField: "_id",
            foreignField: "_id",
            as: "meme",
          },
        },
        { $unwind: { path: "$meme", preserveNullAndEmptyArrays: true } },
      ]),
    ]);

    return res.json({
      totalMemes,
      activeMemes,
      totalViews,
      top: top.map((t) => ({
        memeId: String(t._id),
        views: Number(t.views || 0),
        imageUrl: t.meme?.imageUrl || "",
        caption: t.meme?.caption || "",
        category: t.meme?.category || "general",
        isActive: Boolean(t.meme?.isActive),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

const memeCreateSchema = z.object({
  caption: z.string().optional().default(""),
  category: z.enum(["motivational", "funny", "productivity", "general"]).optional().default("motivational"),
  isActive: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .default(true),
});

router.post(
  "/admin/upload",
  requireAuth,
  requireRole(["super-admin", "admin"]),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const parsed = memeCreateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

      const file = req.file;
      if (!file) return res.status(400).json({ error: { message: "Missing file" } });

      const mimeType = String(file.mimetype || "").toLowerCase();
      if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
        return res.status(400).json({ error: { message: "Only JPG or PNG allowed" } });
      }

      const originalFilename = String(file.originalname || "meme");
      const ext = path.extname(originalFilename).toLowerCase();
      if (ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png") {
        return res.status(400).json({ error: { message: "Only JPG or PNG allowed" } });
      }

      const category = parsed.data.category;
      const uploadedBy = String(req.user?.sub || "");

      let url = "";
      try {
        const s3Url = await uploadToS3(file.buffer, originalFilename, mimeType, `memes/${category}`);
        url = getCdnUrlIfConfigured(s3Url);
      } catch (err) {
        console.error("[meme] uploadToS3 failed:", err);
        return res.status(500).json({ error: { message: `Upload failed: ${String(err?.message || err)}` } });
      }

      const isActive = parsed.data.isActive === "false" ? false : Boolean(parsed.data.isActive);

      const doc = await Meme.create({
        imageUrl: url,
        caption: parsed.data.caption || "",
        category,
        isActive,
        uploadedBy,
        source: "s3",
      });

      return res.json({ item: { ...doc.toObject(), id: String(doc._id) } });
    } catch (err) {
      return next(err);
    }
  }
);

const patchSchema = z.object({
  caption: z.string().optional(),
  category: z.enum(["motivational", "funny", "productivity", "general"]).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/admin/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const memeId = toObjectIdOrNull(req.params.id);
    if (!memeId) return res.status(400).json({ error: { message: "Invalid meme id" } });

    const parsed = patchSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Meme.findByIdAndUpdate(memeId, { $set: parsed.data }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Meme not found" } });

    return res.json({ item: { ...updated, id: String(updated._id) } });
  } catch (err) {
    return next(err);
  }
});

router.delete("/admin/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const memeId = toObjectIdOrNull(req.params.id);
    if (!memeId) return res.status(400).json({ error: { message: "Invalid meme id" } });

    const meme = await Meme.findById(memeId).lean();
    if (!meme) return res.status(404).json({ error: { message: "Meme not found" } });

    await Meme.deleteOne({ _id: memeId });

    // Best-effort: delete S3 file if it is an S3 URL
    await deleteFromS3(meme.imageUrl);

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;