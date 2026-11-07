/* Phase 2 — backfill new fields onto existing notes. Idempotent, chunked,
 * resumable. Old API keeps serving throughout; only sets fields when missing. */
const crypto = require("crypto");
const Note = require("../../models/Note");

function hashOf(title, plain) {
  return crypto.createHash("sha256").update(`${title || ""}\n${plain || ""}`.trim().toLowerCase()).digest("hex");
}

async function up({ batchSize = 500 } = {}) {
  const cursor = Note.find({
    $or: [{ ownerId: null }, { ownerId: { $exists: false } }, { searchText: "" }, { searchText: { $exists: false } }],
  }).cursor();

  let processed = 0;
  let bulk = [];
  const flush = async () => {
    if (!bulk.length) return;
    await Note.bulkWrite(bulk, { ordered: false });
    bulk = [];
  };

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const plain = (doc.body && doc.body.plain) || doc.content || "";
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    const searchText = [doc.title, plain, tags.join(" "), doc.ai && doc.ai.summary].filter(Boolean).join(" \n ");
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            ownerId: doc.ownerId || doc.userId,
            "body.plain": plain,
            content: doc.content || plain,
            searchText,
            contentHash: doc.contentHash || hashOf(doc.title, plain),
            version: doc.version || 1,
          },
        },
      },
    });
    if (bulk.length >= batchSize) await flush();
    processed++;
  }
  await flush();
  console.log(`  ✓ backfilled ${processed} notes`);
  return { processed };
}

module.exports = { up };
