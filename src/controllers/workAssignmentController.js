const service = require("../services/workAssignmentService");
const { resolveActor } = require("../lib/wipIdentity");

function getCorrelationId(req) {
  return String(req.headers["x-correlation-id"] || req.headers["x-request-id"] || "").trim();
}

/**
 * GET /api/employees/live
 */
async function getLiveOverview(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const {
      page = 1,
      limit = 20,
      search = "",
      department = "all",
      status = "all",
      project = "all",
      health = "all",
      sortBy = "name",
      sortDir = "asc",
    } = req.query;

    const data = await service.getEmployeeLiveOverview({
      page,
      limit,
      search,
      department,
      status,
      project,
      health,
      sortBy,
      sortDir,
      actor,
    });

    return res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/employees/:employeeId/live
 */
async function getEmployeeLive(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const { employeeId } = req.params;

    const data = await service.getSingleEmployeeLive(employeeId, actor);
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/employees/:employeeId/activity
 */
async function getEmployeeActivity(req, res, next) {
  try {
    const { employeeId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const data = await service.getEmployeeActivityTimeline(employeeId, { page, limit });
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments
 */
async function createAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const assignment = await service.createAssignment(req.body, actor);
    return res.status(201).json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/start
 */
async function startAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const result = await service.startAssignment(req.params.id, actor, correlationId);
    return res.json({ success: true, item: result.assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/pause
 */
async function pauseAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { reason = "Work paused" } = req.body;
    const assignment = await service.pauseAssignment(req.params.id, { reason }, actor, correlationId);
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/resume
 */
async function resumeAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const result = await service.resumeAssignment(req.params.id, actor, correlationId);
    return res.json({ success: true, item: result.assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/block
 */
async function blockAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: { message: "Reason is required to block an assignment" } });
    }
    const assignment = await service.blockAssignment(req.params.id, { reason }, actor, correlationId);
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/unblock
 */
async function unblockAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { resumeWork = true, resolution = "" } = req.body;
    const assignment = await service.unblockAssignment(req.params.id, { resumeWork, resolution }, actor, correlationId);
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/switch
 */
async function switchAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { toAssignmentId } = req.body;
    if (!toAssignmentId) {
      return res.status(400).json({ error: { message: "toAssignmentId is required" } });
    }
    const result = await service.switchAssignment(req.params.id, toAssignmentId, actor, correlationId);
    return res.json({ success: true, item: result.assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/assignments/:id/estimate
 */
async function updateEstimate(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { expectedActiveSeconds, expectedCompletionAt, reason } = req.body;
    const assignment = await service.updateEstimate(
      req.params.id,
      { expectedActiveSeconds, expectedCompletionAt, reason },
      actor,
      correlationId
    );
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/assignments/:id/progress
 */
async function updateProgress(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const { progressPercent, progressSource, note } = req.body;
    if (progressPercent === undefined || progressPercent < 0 || progressPercent > 100) {
      return res.status(400).json({ error: { message: "progressPercent must be a number between 0 and 100" } });
    }
    const assignment = await service.updateProgress(
      req.params.id,
      { progressPercent, progressSource, note },
      actor,
      correlationId
    );
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/assignments/:id/complete
 */
async function completeAssignment(req, res, next) {
  try {
    const actor = req.actor || (await resolveActor(req));
    const correlationId = getCorrelationId(req);
    const assignment = await service.completeAssignment(req.params.id, actor, correlationId);
    return res.json({ success: true, item: assignment });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLiveOverview,
  getEmployeeLive,
  getEmployeeActivity,
  createAssignment,
  startAssignment,
  pauseAssignment,
  resumeAssignment,
  blockAssignment,
  unblockAssignment,
  switchAssignment,
  updateEstimate,
  updateProgress,
  completeAssignment,
};
