/**
 * Parity check for the /api/dashboard/summary optimisation.
 *
 * The old implementation loaded every Task document and counted in JS. The new
 * one does the same counting inside a single aggregation. This script runs BOTH
 * against the live data and asserts the numbers match, so the change can be
 * verified against real production data before it is trusted.
 *
 * Read-only: it issues finds and aggregations, and writes nothing.
 *
 *   node scripts/verifyDashboardParity.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

function getDayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const Task = require("../src/models/Task");

  const { start, end } = getDayRange(new Date());

  // ---- OLD PATH: pull everything, count in JS -----------------------------
  const t0 = Date.now();
  const tasks = await Task.find({}).lean();
  const oldFetchMs = Date.now() - t0;

  const isCompleted = (t) => String(t?.status || "").toLowerCase() === "completed";
  const isOverdueStatus = (t) => String(t?.status || "").toLowerCase() === "overdue";

  const oldCounts = {
    activeTasks: tasks.filter((t) => !isCompleted(t)).length,
    dueToday: tasks.filter((t) => {
      if (!t?.dueDate) return false;
      const due = new Date(t.dueDate);
      return due >= start && due <= end;
    }).length,
    overdueTasks: tasks.filter((t) => {
      if (isCompleted(t)) return false;
      if (isOverdueStatus(t)) return true;
      if (!t?.dueDate) return false;
      return new Date(t.dueDate) < start;
    }).length,
    pendingBugTasks: tasks.filter((t) => t.category === "bug" && !isCompleted(t)).length,
  };
  const oldTotalMs = Date.now() - t0;

  // ---- NEW PATH: single aggregation --------------------------------------
  const isCompletedExpr = { $eq: [{ $toLower: { $ifNull: ["$status", ""] } }, "completed"] };
  const isOverdueStatusExpr = { $eq: [{ $toLower: { $ifNull: ["$status", ""] } }, "overdue"] };
  const hasDueDateExpr = { $ne: [{ $ifNull: ["$dueDate", null] }, null] };

  const pipeline = [
    { $match: {} },
    {
      $group: {
        _id: null,
        activeTasks: { $sum: { $cond: [isCompletedExpr, 0, 1] } },
        dueToday: {
          $sum: {
            $cond: [
              { $and: [hasDueDateExpr, { $gte: ["$dueDate", start] }, { $lte: ["$dueDate", end] }] },
              1,
              0,
            ],
          },
        },
        overdueTasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $not: [isCompletedExpr] },
                  {
                    $or: [
                      isOverdueStatusExpr,
                      { $and: [hasDueDateExpr, { $lt: ["$dueDate", start] }] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        pendingBugTasks: {
          $sum: {
            $cond: [{ $and: [{ $eq: ["$category", "bug"] }, { $not: [isCompletedExpr] }] }, 1, 0],
          },
        },
      },
    },
  ];

  const t1 = Date.now();
  const rows = await Task.aggregate(pipeline);
  const newTotalMs = Date.now() - t1;

  const newCounts = rows[0] || {
    activeTasks: 0,
    dueToday: 0,
    overdueTasks: 0,
    pendingBugTasks: 0,
  };
  delete newCounts._id;

  // ---- Report -------------------------------------------------------------
  console.log(`\nTask documents scanned: ${tasks.length}`);
  console.log(`OLD  find({}) + JS count : ${oldTotalMs}ms  (fetch alone ${oldFetchMs}ms)`);
  console.log(`NEW  single aggregation  : ${newTotalMs}ms`);
  if (newTotalMs > 0) {
    console.log(`Speedup                  : ${(oldTotalMs / newTotalMs).toFixed(1)}x\n`);
  }

  let mismatches = 0;
  for (const key of Object.keys(oldCounts)) {
    const same = oldCounts[key] === newCounts[key];
    if (!same) mismatches += 1;
    console.log(`${same ? "  OK  " : " FAIL "} ${key}: old=${oldCounts[key]} new=${newCounts[key]}`);
  }

  // Show the plan so index coverage can be confirmed.
  const explain = await Task.collection
    .aggregate(pipeline, { explain: true })
    .catch(() => null);
  if (explain) {
    const stage = JSON.stringify(explain).match(/"stage":"(COLLSCAN|IXSCAN|PROJECTION_COVERED)"/);
    if (stage) console.log(`\nWinning access stage: ${stage[1]}`);
  }

  await mongoose.disconnect();
  if (mismatches > 0) {
    console.error(`\n${mismatches} mismatch(es) — do NOT ship the optimisation.\n`);
    process.exit(1);
  }
  console.log("\nParity confirmed — counts are identical.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
