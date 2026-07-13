const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

/**
 * Startup migration utility to copy legacy AWS S3 files locally
 * and update their database references.
 *
 * Uses the authenticated AWS SDK (via getFromS3) instead of plain HTTP,
 * so private S3 buckets are fully supported.
 */
async function migrateS3ToLocalServer() {
  console.log("[S3 Migration] Starting automated scan of database records...");

  const { getFromS3, extractS3Key } = require("../lib/s3");

  try {
    const modelNames = mongoose.modelNames();
    let totalMigrated = 0;
    let totalFailed = 0;

    for (const modelName of modelNames) {
      const Model = mongoose.model(modelName);

      // Fetch all documents from this collection
      const docs = await Model.find({});

      for (const doc of docs) {
        const updates = {};

        // Recursively find all S3 URLs in the document
        const findS3Urls = (obj, prefix = "") => {
          if (!obj || typeof obj !== "object") return;

          for (const key of Object.keys(obj)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            const val = obj[key];

            if (typeof val === "string" && val.includes("amazonaws.com")) {
              updates[fullPath] = val;
            } else if (Array.isArray(val)) {
              val.forEach((item, idx) => {
                if (typeof item === "string" && item.includes("amazonaws.com")) {
                  updates[`${fullPath}.${idx}`] = item;
                } else if (typeof item === "object" && item !== null) {
                  findS3Urls(item, `${fullPath}.${idx}`);
                }
              });
            } else if (typeof val === "object" && val !== null && !(val instanceof Date)) {
              findS3Urls(val, fullPath);
            }
          }
        };

        const rawObject = doc.toObject ? doc.toObject() : doc;
        // Skip _id and __v
        const { _id, __v, ...rest } = rawObject;
        findS3Urls(rest);

        if (Object.keys(updates).length === 0) continue;

        // Download each S3 file using authenticated SDK and save locally
        const setOps = {};

        for (const [fieldPath, s3Url] of Object.entries(updates)) {
          try {
            console.log(`[S3 Migration] Found S3 URL in ${modelName} (${doc._id}) [${fieldPath}]: ${s3Url}`);

            const s3Key = extractS3Key(s3Url);
            if (!s3Key) {
              console.warn(`[S3 Migration] Could not extract S3 key from: ${s3Url}`);
              totalFailed++;
              continue;
            }

            // Download using authenticated AWS SDK
            const { stream, contentType } = await getFromS3(s3Key);

            // Collect stream into buffer
            const chunks = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            // Build local destination path preserving folder structure
            const originalName = path.basename(s3Key);
            const folder = path.dirname(s3Key) || "uploads";
            const fileExtension = path.extname(originalName);
            const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${fileExtension}`;
            const destPath = path.join(__dirname, "../../uploads", folder, uniqueName);

            await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
            await fs.promises.writeFile(destPath, buffer);

            const localUrl = `/uploads/${folder}/${uniqueName}`;
            setOps[fieldPath] = localUrl;
            totalMigrated++;
            console.log(`[S3 Migration] Migrated to local server: ${localUrl}`);
          } catch (err) {
            console.error(`[S3 Migration] Failed to migrate ${s3Url}:`, err.message);
            totalFailed++;
          }
        }

        // Apply all updates for this document in one DB write
        if (Object.keys(setOps).length > 0) {
          await Model.findByIdAndUpdate(doc._id, { $set: setOps });
        }
      }
    }

    console.log(`[S3 Migration] Complete. Migrated ${totalMigrated} files, ${totalFailed} failed.`);
  } catch (err) {
    console.error("[S3 Migration] Error during migration run:", err);
  }
}

module.exports = {
  migrateS3ToLocalServer,
};
