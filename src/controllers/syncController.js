const mongoose = require("mongoose");
const Task = require("../models/Task");
const Project = require("../models/Project");
const TaskComment = require("../models/TaskComment");
const SyncLedger = require("../models/SyncLedger");
const SyncSequence = require("../models/SyncSequence");
const SyncQuarantine = require("../models/SyncQuarantine");

/**
 * Handle batch push operations from offline clients with idempotency and monotonic LSN logging.
 */
async function pushSync(req, res) {
  const { operations, client_instance_id: clientInstanceId } = req.body;
  const userId = req.user?.id || req.user?._id || "anonymous";

  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({ error: { message: "No operations provided in batch." } });
  }

  const results = [];

  for (const op of operations) {
    const operationId = op.operation_id || op.operationId;
    const entityType = (op.entity_type || op.entityType || "").toLowerCase();
    const entityId = op.entity_id || op.entityId;
    const operationType = (op.operation_type || op.operationType || "").toUpperCase();
    const clientTimestamp = op.client_timestamp || op.clientTimestamp ? new Date(op.client_timestamp || op.clientTimestamp) : new Date();
    const data = op.data || {};

    if (!operationId || !entityType || !operationType) {
      results.push({
        operation_id: operationId || "unknown",
        entity_id: entityId,
        status: "REJECTED_INVALID_PAYLOAD",
        error: "Missing required operation metadata.",
      });
      continue;
    }

    try {
      // 1. Idempotency check
      const existingLog = await SyncLedger.findOne({ clientOperationId: operationId }).lean();
      if (existingLog) {
        results.push({
          operation_id: operationId,
          entity_id: entityId,
          status: "ALREADY_APPLIED",
          server_lsn: existingLog.serverLsn,
          version: existingLog.version,
          server_updated_at: existingLog.updatedAt,
        });
        continue;
      }

      // 2. Obtain Next Monotonic Sequence Number
      const nextLsn = await SyncSequence.getNextLsn();
      let updatedDoc = null;
      let version = 1;

      // 3. Domain Entity Mutation
      if (entityType === "task") {
        if (operationType === "INSERT") {
          const taskData = {
            ...data,
            createdBy: {
              userId: String(userId),
              name: req.user?.name || req.user?.username || "Sync User",
              email: req.user?.email || "",
              role: req.user?.role || "",
            },
          };
          if (entityId && mongoose.Types.ObjectId.isValid(entityId)) {
            taskData._id = entityId;
          }
          const taskDoc = new Task(taskData);
          updatedDoc = await taskDoc.save();
          version = updatedDoc.__v || 1;
        } else if (operationType === "UPDATE") {
          updatedDoc = await Task.findByIdAndUpdate(
            entityId,
            { $set: data, $inc: { __v: 1 } },
            { new: true }
          );
          version = updatedDoc ? updatedDoc.__v : 1;
        } else if (operationType === "DELETE") {
          updatedDoc = await Task.findByIdAndUpdate(
            entityId,
            { $set: { status: "completed", isDeleted: true }, $inc: { __v: 1 } },
            { new: true }
          );
          version = updatedDoc ? updatedDoc.__v : 1;
        }
      } else if (entityType === "project") {
        if (operationType === "INSERT") {
          const projectData = {
            ...data,
            createdByUserId: String(userId),
            createdByUsername: req.user?.username || req.user?.name || "Sync User",
          };
          if (entityId && mongoose.Types.ObjectId.isValid(entityId)) {
            projectData._id = entityId;
          }
          const projectDoc = new Project(projectData);
          updatedDoc = await projectDoc.save();
          version = updatedDoc.__v || 1;
        } else if (operationType === "UPDATE") {
          updatedDoc = await Project.findByIdAndUpdate(
            entityId,
            { $set: data, $inc: { __v: 1 } },
            { new: true }
          );
          version = updatedDoc ? updatedDoc.__v : 1;
        } else if (operationType === "DELETE") {
          updatedDoc = await Project.findByIdAndUpdate(
            entityId,
            { $set: { status: "archived", isDeleted: true }, $inc: { __v: 1 } },
            { new: true }
          );
          version = updatedDoc ? updatedDoc.__v : 1;
        }
      } else if (entityType === "comment") {
        if (operationType === "INSERT") {
          const commentData = {
            ...data,
            userId: String(userId),
            username: req.user?.username || req.user?.name || "Sync User",
          };
          if (entityId && mongoose.Types.ObjectId.isValid(entityId)) {
            commentData._id = entityId;
          }
          const commentDoc = new TaskComment(commentData);
          updatedDoc = await commentDoc.save();
          version = commentDoc.__v || 1;
        } else if (operationType === "DELETE") {
          await TaskComment.findByIdAndDelete(entityId);
          version = 1;
        }
      }

      // 4. Record to Monotonic SyncLedger
      const ledgerEntry = await SyncLedger.create({
        serverLsn: nextLsn,
        entityType,
        entityId: entityId || (updatedDoc ? updatedDoc._id : null),
        operationType,
        version,
        isDeleted: operationType === "DELETE" || Boolean(data.isDeleted),
        data: updatedDoc ? updatedDoc.toObject() : data,
        clientOperationId: operationId,
        clientTimestamp,
        updatedBy: String(userId),
      });

      results.push({
        operation_id: operationId,
        entity_id: entityId || (updatedDoc ? updatedDoc._id : null),
        status: "ACCEPTED",
        server_lsn: nextLsn,
        version,
        server_updated_at: ledgerEntry.createdAt,
      });
    } catch (opErr) {
      console.error(`[pushSync] Error processing operation ${operationId}:`, opErr);

      // Log to Quarantine collection so failed individual mutations do not corrupt pipeline
      await SyncQuarantine.create({
        clientOperationId: operationId,
        entityType,
        entityId,
        operationType,
        payload: data,
        errorCode: "OP_EXECUTION_ERROR",
        errorMessage: opErr.message,
        userId: String(userId),
        clientTimestamp,
      }).catch((qErr) => console.error("[pushSync] Quarantine logging failed:", qErr));

      results.push({
        operation_id: operationId,
        entity_id: entityId,
        status: "QUARANTINED",
        error: opErr.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    processed_at: Date.now(),
    results,
  });
}

/**
 * Handle pull delta requests using client's last observed LSN cursor.
 */
async function pullSync(req, res) {
  try {
    const {
      last_server_lsn = 0,
      batch_limit = 250,
      entity_types = [],
    } = req.body;

    const query = {
      serverLsn: { $gt: Number(last_server_lsn) },
    };

    if (Array.isArray(entity_types) && entity_types.length > 0) {
      query.entityType = { $in: entity_types.map((t) => t.toLowerCase()) };
    }

    const limit = Math.min(Math.max(Number(batch_limit) || 250, 1), 1000);

    const changes = await SyncLedger.find(query)
      .sort({ serverLsn: 1 })
      .limit(limit)
      .lean();

    const highestLsn =
      changes.length > 0 ? changes[changes.length - 1].serverLsn : Number(last_server_lsn);
    const hasMore = changes.length === limit;

    return res.status(200).json({
      has_more: hasMore,
      highest_lsn: highestLsn,
      changes: changes.map((c) => ({
        server_lsn: c.serverLsn,
        entity_type: c.entityType,
        entity_id: c.entityId,
        operation_type: c.operationType,
        version: c.version,
        is_deleted: c.isDeleted,
        data: c.data,
        updated_at: c.createdAt,
      })),
    });
  } catch (err) {
    console.error("[pullSync] Error fetching delta changes:", err);
    return res.status(500).json({ error: { message: err.message } });
  }
}

/**
 * Fetch synchronization status and latest global sequence counter.
 */
async function getStatus(req, res) {
  try {
    const counter = await SyncSequence.findById("global_sync_lsn").lean();
    return res.status(200).json({
      current_lsn: counter ? counter.seq : 0,
      server_timestamp: Date.now(),
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}

module.exports = {
  pushSync,
  pullSync,
  getStatus,
};
