#!/usr/bin/env node
/**
 * Reports whether the configured MongoDB deployment supports multi-document
 * transactions (required by the WIP Dashboard's audited writes).
 *
 * Read-only: issues a single `hello` admin command. Writes nothing.
 *
 *   node scripts/check-mongo-topology.js
 *
 * Exit 0 = transactions supported. Exit 1 = standalone (must be fixed).
 */

require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  // Mask credentials before printing.
  const safeUri = uri.replace(/\/\/[^:]+:[^@]+@/, "//<user>:<pass>@");
  console.log(`Connecting to: ${safeUri}\n`);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    const build = await admin.command({ buildInfo: 1 });

    const isReplicaSet = Boolean(hello.setName);
    const isSharded = hello.msg === "isdbgrid";
    const supported = isReplicaSet || isSharded;

    console.log(`MongoDB version : ${build.version}`);
    console.log(`Topology        : ${isSharded ? "sharded (mongos)" : isReplicaSet ? `replica set "${hello.setName}"` : "STANDALONE"}`);
    if (isReplicaSet) {
      console.log(`Members         : ${(hello.hosts || []).join(", ") || "n/a"}`);
      console.log(`Primary         : ${hello.primary || "n/a"}`);
    }
    console.log(`Transactions    : ${supported ? "SUPPORTED" : "NOT SUPPORTED"}`);
    console.log(`Change streams  : ${supported ? "SUPPORTED" : "NOT SUPPORTED"}`);

    if (!supported) {
      console.error(
        "\n❌ This deployment is a STANDALONE.\n" +
          "   The WIP Dashboard writes a session document and its audit event together.\n" +
          "   Without transactions those writes cannot be made atomic, so the audit log can lie.\n\n" +
          "   Fix: convert to a single-node replica set (same one server, no extra hardware).\n" +
          "   See docs/WIP_DASHBOARD.md → 'Self-hosted MongoDB'.\n"
      );
      process.exitCode = 1;
    } else {
      console.log("\n✅ Safe to run the WIP Dashboard with full audit guarantees.");
      process.exitCode = 0;
    }
  } catch (err) {
    console.error(`\nConnection failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
})();
