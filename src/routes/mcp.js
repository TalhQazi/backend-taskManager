const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const Task = require("../models/Task");
const Project = require("../models/Project");
const Employee = require("../models/Employee");

const MCP_SERVER_FILE = path.resolve(__dirname, "../mcp/server.js");

const MCP_TOOLS = [
  {
    name: "list_tasks",
    description: "Search and retrieve tasks with optional filtering by status, priority, assignee, search keyword, or project.",
    parameters: ["search", "status (all|pending|in-progress|completed|overdue)", "priority (all|high|medium|low)", "assignee", "limit"],
  },
  {
    name: "get_task",
    description: "Retrieve complete details for a single task by MongoDB ID or human-readable task number.",
    parameters: ["taskId", "taskNumber"],
  },
  {
    name: "create_task",
    description: "Create a new task in Task Manager with title, description, priority, assignees, due date, and location.",
    parameters: ["title (required)", "description (required)", "priority", "status", "assignees", "dueDate", "dueTime", "location"],
  },
  {
    name: "update_task",
    description: "Update an existing task's status, priority, assignees, or description.",
    parameters: ["taskId (required)", "status", "priority", "description", "assignees"],
  },
  {
    name: "list_projects",
    description: "List all active projects in Task Manager.",
    parameters: ["search", "limit"],
  },
  {
    name: "list_employees",
    description: "List active employees and team members with their roles and departments.",
    parameters: ["department", "role", "limit"],
  },
  {
    name: "get_system_overview",
    description: "Get a high-level summary of tasks, projects, employees, and system statistics in Task Manager.",
    parameters: [],
  },
];

// Helper: MCP & ChatGPT Authentication Middleware
function requireMcpAuth(req, res, next) {
  const configuredSecret =
    process.env.MCP_API_KEY ||
    process.env.SERVER_AGENT_API_KEY ||
    "taskmanager-mcp-key-2026";

  // 1. Check X-API-Key header or query param
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  if (apiKey && apiKey === configuredSecret) {
    req.user = { role: "admin", email: "chatgpt@taskmanager.local", name: "ChatGPT Action" };
    return next();
  }

  // 2. Check Authorization header (Bearer ...)
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === configuredSecret) {
      req.user = { role: "admin", email: "chatgpt@taskmanager.local", name: "ChatGPT Action" };
      return next();
    }

    // Try standard JWT verification
    try {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const payload = jwt.verify(token, secret);
        req.user = payload;
        req.user._id = String(payload.sub || payload.id || payload._id || "");
        return next();
      }
    } catch {
      // Continue to unauthorized response
    }
  }

  return res.status(401).json({
    error: {
      message: "Unauthorized. Please provide a valid API key (X-API-Key header) or Bearer token.",
      code: "INVALID_CREDENTIALS",
    },
  });
}

// -------------------------------------------------------------
// PUBLIC: GET /api/mcp/openapi.json
// OpenAPI 3.0.2 specification for ChatGPT Actions & Custom GPTs
// -------------------------------------------------------------
router.get("/openapi.json", (req, res) => {
  const host = req.get("host") || "task.se7eninc.com";
  const protocol =
    req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const baseUrl = `${protocol}://${host}/api/mcp`;

  const spec = {
    openapi: "3.0.2",
    info: {
      title: "Task Manager ChatGPT API",
      version: "1.0.0",
      description:
        "Direct Actions API for ChatGPT and Custom GPTs to read, search, create, and update tasks, projects, employees, and statistics in Task Manager.",
    },
    servers: [
      {
        url: baseUrl,
        description: "Task Manager MCP & ChatGPT API Server",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API Key authentication header for Task Manager",
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Bearer authentication using API Key or JWT token",
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      "/chatgpt/overview": {
        get: {
          operationId: "getSystemOverview",
          summary: "Get Task Manager system overview and live metrics",
          description: "Retrieves summary statistics for total tasks, status breakdowns, projects, and employees.",
          responses: {
            "200": {
              description: "System overview returned successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      system: { type: "string" },
                      status: { type: "string" },
                      summary: {
                        type: "object",
                        properties: {
                          totalTasks: { type: "integer" },
                          tasksByStatus: {
                            type: "object",
                            properties: {
                              pending: { type: "integer" },
                              inProgress: { type: "integer" },
                              completed: { type: "integer" },
                            },
                          },
                          totalProjects: { type: "integer" },
                          totalEmployees: { type: "integer" },
                        },
                      },
                      timestamp: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/chatgpt/tasks": {
        get: {
          operationId: "listTasks",
          summary: "Search and filter tasks",
          description: "Retrieve a list of tasks with optional filtering by status, priority, assignee, search keyword, or limit.",
          parameters: [
            {
              name: "search",
              in: "query",
              required: false,
              description: "Search keyword matching title or description",
              schema: { type: "string" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              description: "Filter by status: pending, in-progress, completed, overdue, or all",
              schema: { type: "string", enum: ["all", "pending", "in-progress", "completed", "overdue"] },
            },
            {
              name: "priority",
              in: "query",
              required: false,
              description: "Filter by priority: high, medium, low, or all",
              schema: { type: "string", enum: ["all", "high", "medium", "low"] },
            },
            {
              name: "assignee",
              in: "query",
              required: false,
              description: "Filter tasks assigned to a specific person's name",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Max number of tasks to return (default 20, max 100)",
              schema: { type: "integer", default: 20 },
            },
          ],
          responses: {
            "200": {
              description: "List of matching tasks",
            },
          },
        },
        post: {
          operationId: "createTask",
          summary: "Create a new task",
          description: "Create a new task with title, description, priority, assignees, due date, and location.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "description"],
                  properties: {
                    title: { type: "string", description: "Title of the task" },
                    description: { type: "string", description: "Detailed description of requirements" },
                    priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
                    status: { type: "string", enum: ["pending", "in-progress", "completed"], default: "pending" },
                    assignees: { type: "array", items: { type: "string" }, description: "Names of assignees" },
                    dueDate: { type: "string", description: "Due date in YYYY-MM-DD format" },
                    dueTime: { type: "string", description: "Due time string (e.g. 5:00 PM)" },
                    location: { type: "string", description: "Task location or facility" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Task created successfully",
            },
          },
        },
      },
      "/chatgpt/tasks/{id}": {
        get: {
          operationId: "getTask",
          summary: "Get task details",
          description: "Retrieve comprehensive details of a task by its MongoDB ID or task number.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "The MongoDB ID or task number (e.g. 104)",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Task details returned",
            },
          },
        },
        put: {
          operationId: "updateTask",
          summary: "Update an existing task",
          description: "Update the status, priority, description, or assignees of a task.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "The MongoDB ID or task number",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["pending", "in-progress", "completed", "overdue"] },
                    priority: { type: "string", enum: ["high", "medium", "low"] },
                    description: { type: "string" },
                    assignees: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task updated successfully",
            },
          },
        },
      },
      "/chatgpt/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          description: "Retrieve a list of active projects in Task Manager.",
          parameters: [
            {
              name: "search",
              in: "query",
              required: false,
              description: "Search keyword matching project name",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Max number of projects to return (default 25)",
              schema: { type: "integer", default: 25 },
            },
          ],
          responses: {
            "200": {
              description: "List of projects",
            },
          },
        },
      },
      "/chatgpt/employees": {
        get: {
          operationId: "listEmployees",
          summary: "List team members and employees",
          description: "Retrieve team members with their roles and departments.",
          parameters: [
            {
              name: "department",
              in: "query",
              required: false,
              description: "Filter by department",
              schema: { type: "string" },
            },
            {
              name: "role",
              in: "query",
              required: false,
              description: "Filter by role",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Max number of employees to return (default 50)",
              schema: { type: "integer", default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "List of employees",
            },
          },
        },
      },
    },
  };

  res.setHeader("Content-Type", "application/json");
  res.json(spec);
});

// -------------------------------------------------------------
// GET /api/mcp/status - returns MCP status, configurations, and tool registry
// -------------------------------------------------------------
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const isDbReady = mongoose.connection.readyState === 1;
    const normalizedPath = MCP_SERVER_FILE.replace(/\\/g, "/");

    const host = req.get("host") || "task.se7eninc.com";
    const protocol =
      req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const openApiUrl = `${protocol}://${host}/api/mcp/openapi.json`;
    const chatgptApiKey =
      process.env.MCP_API_KEY ||
      process.env.SERVER_AGENT_API_KEY ||
      "taskmanager-mcp-key-2026";

    const antigravityConfig = {
      mcpServers: {
        "task-manager": {
          command: "node",
          args: [normalizedPath],
          env: {},
        },
      },
    };

    const claudeConfig = {
      mcpServers: {
        "task-manager": {
          command: "node",
          args: [normalizedPath],
          env: {},
        },
      },
    };

    const cursorConfig = {
      mcpServers: {
        "task-manager": {
          command: "node",
          args: [normalizedPath],
        },
      },
    };

    // Quick stats
    let totalTasks = 0;
    let totalProjects = 0;
    let totalEmployees = 0;

    if (isDbReady) {
      [totalTasks, totalProjects, totalEmployees] = await Promise.all([
        Task.countDocuments(),
        Project.countDocuments(),
        Employee.countDocuments(),
      ]);
    }

    res.json({
      status: "active",
      serverPath: normalizedPath,
      protocol: "Model Context Protocol (JSON-RPC 2.0 over stdio) & OpenAPI 3.0 Actions",
      databaseConnected: isDbReady,
      tools: MCP_TOOLS,
      openApiUrl,
      chatgptApiKey,
      stats: {
        totalTasks,
        totalProjects,
        totalEmployees,
        availableTools: MCP_TOOLS.length,
      },
      configs: {
        antigravity: JSON.stringify(antigravityConfig, null, 2),
        claude: JSON.stringify(claudeConfig, null, 2),
        cursor: JSON.stringify(cursorConfig, null, 2),
      },
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// POST /api/mcp/test-tool - live execution test for MCP tools from Admin UI
// -------------------------------------------------------------
router.post("/test-tool", requireAuth, async (req, res, next) => {
  try {
    const { toolName } = req.body;

    if (!toolName) {
      return res.status(400).json({ error: { message: "toolName is required" } });
    }

    let result = null;

    if (toolName === "get_system_overview") {
      const [totalTasks, pendingTasks, inProgressTasks, completedTasks, totalProjects, totalEmployees] =
        await Promise.all([
          Task.countDocuments(),
          Task.countDocuments({ status: "pending" }),
          Task.countDocuments({ status: "in-progress" }),
          Task.countDocuments({ status: "completed" }),
          Project.countDocuments(),
          Employee.countDocuments(),
        ]);

      result = {
        system: "Task Manager MCP Server",
        status: "operational",
        summary: {
          totalTasks,
          tasksByStatus: {
            pending: pendingTasks,
            inProgress: inProgressTasks,
            completed: completedTasks,
          },
          totalProjects,
          totalEmployees,
        },
        timestamp: new Date().toISOString(),
      };
    } else if (toolName === "list_tasks") {
      const tasks = await Task.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("taskNumber title status priority assignees")
        .lean();

      result = {
        totalReturned: tasks.length,
        tasks: tasks.map((t) => ({
          taskNumber: t.taskNumber,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assignees: t.assignees || [],
        })),
      };
    } else if (toolName === "list_projects") {
      const projects = await Project.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name title status")
        .lean();

      result = {
        totalReturned: projects.length,
        projects,
      };
    } else if (toolName === "list_employees") {
      const employees = await Employee.find()
        .limit(5)
        .select("name email role department")
        .lean();

      result = {
        totalReturned: employees.length,
        employees,
      };
    } else {
      result = {
        message: `Tool ${toolName} registered and valid.`,
        parameters: MCP_TOOLS.find((t) => t.name === toolName)?.parameters || [],
      };
    }

    res.json({ success: true, toolName, result });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// CHATGPT ACTIONS REST ENDPOINTS (Protected with requireMcpAuth)
// -------------------------------------------------------------

// GET /api/mcp/chatgpt/overview
router.get("/chatgpt/overview", requireMcpAuth, async (req, res, next) => {
  try {
    const [totalTasks, pendingTasks, inProgressTasks, completedTasks, totalProjects, totalEmployees] =
      await Promise.all([
        Task.countDocuments(),
        Task.countDocuments({ status: "pending" }),
        Task.countDocuments({ status: "in-progress" }),
        Task.countDocuments({ status: "completed" }),
        Project.countDocuments(),
        Employee.countDocuments(),
      ]);

    res.json({
      system: "Task Manager MCP Server",
      status: "operational",
      summary: {
        totalTasks,
        tasksByStatus: {
          pending: pendingTasks,
          inProgress: inProgressTasks,
          completed: completedTasks,
        },
        totalProjects,
        totalEmployees,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/mcp/chatgpt/tasks
router.get("/chatgpt/tasks", requireMcpAuth, async (req, res, next) => {
  try {
    const { search, status, priority, assignee, limit } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }
    if (priority && priority !== "all") {
      filter.priority = priority;
    }
    if (assignee) {
      filter.assignees = { $in: [assignee] };
    }
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const maxLimit = Math.min(Number(limit) || 20, 100);
    const tasks = await Task.find(filter)
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .select("taskNumber title description status priority assignees dueDate dueTime createdAt")
      .lean();

    res.json({
      totalFound: tasks.length,
      tasks: tasks.map((t) => ({
        id: String(t._id),
        taskNumber: t.taskNumber,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignees: t.assignees || [],
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString().split("T")[0] : null,
        dueTime: t.dueTime || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/mcp/chatgpt/tasks
router.post("/chatgpt/tasks", requireMcpAuth, async (req, res, next) => {
  try {
    const { title, description, priority, status, assignees, dueDate, dueTime, location } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: { message: "title and description are required" } });
    }

    const last = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
    const nextTaskNumber = (last?.taskNumber || 0) + 1;

    const created = await Task.create({
      taskNumber: nextTaskNumber,
      title: title.trim(),
      description: description.trim(),
      priority: priority || "medium",
      status: status || "pending",
      assignees: Array.isArray(assignees) ? assignees : [],
      dueDate: dueDate ? new Date(dueDate) : undefined,
      dueTime: dueTime || "",
      location: location || "",
      createdAt: new Date().toISOString().split("T")[0],
    });

    res.status(201).json({
      message: `Task #${created.taskNumber} created successfully`,
      taskId: String(created._id),
      taskNumber: created.taskNumber,
      title: created.title,
      status: created.status,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/mcp/chatgpt/tasks/:id
router.get("/chatgpt/tasks/:id", requireMcpAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    let query = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      const num = Number(id);
      if (!isNaN(num)) query = { taskNumber: num };
    }

    if (!query) {
      return res.status(400).json({ error: { message: "Invalid taskId or taskNumber" } });
    }

    const task = await Task.findOne(query).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    res.json({
      id: String(task._id),
      taskNumber: task.taskNumber,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignees: task.assignees || [],
      teamLead: task.teamLead || null,
      location: task.location || null,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : null,
      dueTime: task.dueTime || null,
      createdAt: task.createdAt,
      attachmentsCount: (task.attachments || []).length,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/mcp/chatgpt/tasks/:id
router.put("/chatgpt/tasks/:id", requireMcpAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    let query = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      const num = Number(id);
      if (!isNaN(num)) query = { taskNumber: num };
    }

    if (!query) {
      return res.status(400).json({ error: { message: "Invalid taskId or taskNumber" } });
    }

    const { status, priority, description, assignees } = req.body;
    const updateFields = {};
    if (status) updateFields.status = status;
    if (priority) updateFields.priority = priority;
    if (description) updateFields.description = description;
    if (assignees) updateFields.assignees = assignees;

    const updated = await Task.findOneAndUpdate(query, { $set: updateFields }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found to update" } });
    }

    res.json({
      message: `Task #${updated.taskNumber} updated successfully`,
      task: {
        id: String(updated._id),
        taskNumber: updated.taskNumber,
        title: updated.title,
        status: updated.status,
        priority: updated.priority,
        assignees: updated.assignees,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/mcp/chatgpt/projects
router.get("/chatgpt/projects", requireMcpAuth, async (req, res, next) => {
  try {
    const { search, limit } = req.query;
    const filter = {};
    if (search) {
      filter.name = new RegExp(search, "i");
    }
    const maxLimit = Math.min(Number(limit) || 25, 100);
    const projects = await Project.find(filter).sort({ createdAt: -1 }).limit(maxLimit).lean();

    res.json({
      count: projects.length,
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        title: p.title || p.name,
        status: p.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/mcp/chatgpt/employees
router.get("/chatgpt/employees", requireMcpAuth, async (req, res, next) => {
  try {
    const { department, role, limit } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (role) filter.role = role;

    const maxLimit = Math.min(Number(limit) || 50, 100);
    const employees = await Employee.find(filter).limit(maxLimit).select("name email role department").lean();

    res.json({
      count: employees.length,
      employees: employees.map((e) => ({
        id: String(e._id),
        name: e.name,
        email: e.email,
        role: e.role,
        department: e.department,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
