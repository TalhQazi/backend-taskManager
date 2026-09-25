/* Knowledge Vault migration runner.
 *
 *   node src/migrations/knowledge/run.js 001_indexes
 *   node src/migrations/knowledge/run.js 002_backfill
 *   node src/migrations/knowledge/run.js all
 *
 * Reads MONGODB_URI from the environment (.env). Safe/idempotent migrations.
 */
try { require("dotenv").config(); } catch { /* dotenv optional */ }
const mongoose = require("mongoose");

const ORDER = ["001_indexes", "002_backfill"];

async function main() {
  const arg = process.argv[2] || "all";
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[KV migrate] connected → running: ${arg}`);

  const toRun = arg === "all" ? ORDER : [arg];
  for (const name of toRun) {
    const mod = require(`./${name}`);
    console.log(`\n▶ ${name}`);
    await mod.up();
  }

  await mongoose.disconnect();
  console.log("\n[KV migrate] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[KV migrate] failed:", err);
  process.exit(1);
});
