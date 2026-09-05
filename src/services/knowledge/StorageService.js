/* ------------------------------------------------------------------ *
 * StorageService — binary/media storage for the Knowledge Vault.
 * S3 is removed; the default driver is GridFS (MongoDB native), with a
 * local-disk driver as a fallback. Note logic never references a provider.
 * ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const crypto = require("crypto");
const { Readable } = require("stream");

const BUCKET = "kv_media";

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection not ready for GridFS");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

function toStream(input) {
  if (input && typeof input.pipe === "function") return input; // already a stream
  return Readable.from(Buffer.isBuffer(input) ? input : Buffer.from(input));
}

const GridFSDriver = {
  put(input, { fileName, mimeType, organizationId, ownerId }) {
    return new Promise((resolve, reject) => {
      const upload = bucket().openUploadStream(fileName || "file", {
        metadata: { organizationId: organizationId || null, ownerId: ownerId || null, mimeType: mimeType || "" },
      });
      let size = 0;
      const src = toStream(input);
      src.on("data", (c) => (size += c.length));
      src
        .pipe(upload)
        .on("error", reject)
        .on("finish", () =>
          resolve({ storage: "gridfs", fileId: upload.id, fileName: fileName || "file", mimeType: mimeType || "", size })
        );
    });
  },
  getStream(ref) {
    return bucket().openDownloadStream(new mongoose.Types.ObjectId(ref.fileId));
  },
  async remove(ref) {
    try {
      await bucket().delete(new mongoose.Types.ObjectId(ref.fileId));
    } catch (err) {
      console.error("[KV Storage.remove]", err.message);
    }
  },
};

const StorageService = {
  driver: GridFSDriver,

  put(input, meta) {
    return this.driver.put(input, meta);
  },
  getStream(ref) {
    return this.driver.getStream(ref);
  },
  remove(ref) {
    return this.driver.remove(ref);
  },

  /** Short-lived HMAC token so <img>/<video> tags can stream without a public URL. */
  signAccess(ref, ttlSeconds = 300) {
    const secret = process.env.JWT_SECRET || "kv-media";
    const exp = Date.now() + ttlSeconds * 1000;
    const payload = `${ref.fileId}.${exp}`;
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return { token: `${exp}.${sig}`, exp };
  },
  verifyAccess(fileId, token) {
    if (!token) return false;
    const [exp, sig] = String(token).split(".");
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const secret = process.env.JWT_SECRET || "kv-media";
    const expected = crypto.createHmac("sha256", secret).update(`${fileId}.${exp}`).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  },
};

module.exports = StorageService;
