/* Phase 1 — build all Knowledge Vault indexes in the background.
 * Idempotent: syncIndexes() creates missing indexes and is safe to re-run.
 * Preserves the existing notes text index (never dropped here). */
const Note = require("../../models/Note");
const kv = require("../../models/knowledge");

async function up() {
  const models = [Note, kv.Folder, kv.Category, kv.Tag, kv.NoteVersion, kv.NoteRelationship,
    kv.NoteShare, kv.NoteComment, kv.AiSession, kv.AiCommand, kv.AiSuggestion, kv.NoteEmbedding,
    kv.AuditLog, kv.ActivityHistory, kv.UndoHistory, kv.Permission];

  for (const model of models) {
    try {
      await model.createIndexes(); // background per index spec; won't drop the legacy text index
      console.log(`  ✓ indexes ensured: ${model.collection.name}`);
    } catch (err) {
      console.error(`  ✗ ${model.collection.name}: ${err.message}`);
    }
  }
}

module.exports = { up };
