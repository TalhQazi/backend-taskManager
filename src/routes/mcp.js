const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
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

// GET /api/mcp/status - returns MCP status, configurations, and tool registry
router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const isDbReady = mongoose.connection.readyState === 1;
    const normalizedPath = MCP_SERVER_FILE.replace(/\\/g, "/");

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
      protocol: "Model Context Protocol (JSON-RPC 2.0 over stdio)",
      databaseConnected: isDbReady,
      tools: MCP_TOOLS,
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

// POST /api/mcp/test-tool - live execution test for MCP tools from Admin UI
router.post("/test-tool", requireAuth, async (req, res, next) => {
  try {
    const { toolName, args = {} } = req.body;

    if (!toolName) {
      return res.status(400).json({ error: { message: "toolName is required" } });
    }

    let result = null;

    if (toolName === "get_system_overview") {
      const [totalTasks, pendingTasks, inProgressTasks, completedTasks, totalProjects, totalEmployees] = await Promise.all([
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
        tasks: tasks.map(t => ({
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
        parameters: MCP_TOOLS.find(t => t.name === toolName)?.parameters || [],
      };
    }

    res.json({ success: true, toolName, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

