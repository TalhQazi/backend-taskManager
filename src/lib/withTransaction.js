/**
 * Multi-document write helper.
 *
 * Starting a task writes a session doc AND an event doc. Those must land
 * together or not at all — otherwise the audit log lies. The deployment is
 * MongoDB Atlas (mongodb+srv), which is always a replica set, so transactions
 * are available.
 *
 * We probe support once. If the server turns out to be a standalone (local dev
 * without a replica set), we fail loudly rather than silently degrading the
 * audit guarantee — except when WIP_ALLOW_NON_TRANSACTIONAL=true is explicitly
 * set, which is intended for local scratch work only.
 */

const mongoose = require("mongoose");

let transactionSupport = null; // null = unknown, true/false once probed

async function detectTransactionSupport() {
  if (transactionSupport !== null) return transactionSupport;
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    // `setName` present => replica set. `msg: "isdbgrid"` => sharded mongos.
    transactionSupport = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    transactionSupport = false;
  }
  if (!transactionSupport) {
    console.warn(
      "[WIP] MongoDB deployment is standalone — multi-document transactions are unavailable. " +
        "Session+event writes cannot be made atomic. Fix the deployment (replica set) " +
        "or set WIP_ALLOW_NON_TRANSACTIONAL=true to proceed without the audit guarantee."
    );
  }
  return transactionSupport;
}

/**
 * Run `fn(session)` inside a transaction when supported.
 * @param {(session: import("mongoose").ClientSession|null) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const supported = await detectTransactionSupport();

  if (!supported) {
    if (String(process.env.WIP_ALLOW_NON_TRANSACTIONAL).toLowerCase() !== "true") {
      const err = new Error(
        "Multi-document transactions are required but this MongoDB deployment is standalone."
      );
      err.status = 500;
      err.code = "TRANSACTIONS_UNAVAILABLE";
      throw err;
    }
    // Explicitly opted out: run without a session.
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Reset the probe (tests). */
function _resetTransactionSupport() {
  transactionSupport = null;
}

module.exports = { withTransaction, detectTransactionSupport, _resetTransactionSupport };
