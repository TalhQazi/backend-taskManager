#!/usr/bin/env node
/**
 * Task Manager Model Context Protocol (MCP) Server
 * Connects AI assistants (Antigravity, Claude, Cursor, ChatGPT, etc.)
 * directly to Task Manager to query, create, and manage tasks, projects,
 * employees, and files.
 *
 * Implements the official Model Context Protocol (JSON-RPC 2.0 over stdio).
 */

const readline = require("readline");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

// Load backend environment
const envPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

// Log to stderr only so stdout remains clean for JSON-RPC
function log(...args) {
  process.stderr.write(`[Task Manager MCP] ${args.join(" ")}\n`);
}

// Lazy database connection
let dbConnected = false;
let dbConnecting = false;

async function ensureDb() {
  if (dbConnected) return;
  if (dbConnecting) {
    while (dbConnecting) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return;
  }
  dbConnecting = true;
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      log("Warning: MONGODB_URI not found in .env, database operations may fail.");
      dbConnecting = false;
      return;
    }
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    dbConnected = true;
    log("Connected to MongoDB database.");
  } catch (err) {
    log("Failed to connect to MongoDB:", err.message);
  } finally {
    dbConnecting = false;
  }
}

// Lazy load Mongoose models
function getModels() {
  const Task = require("../models/Task");
  const Project = require("../models/Project");
  const Employee = require("../models/Employee");
  const CRMFile = require("../models/CRMFile");
  return { Task, Project, Employee, CRMFile };
}

// Tool definitions for MCP
const TOOLS = [
  {
    name: "list_tasks",
    description: "Search and retrieve tasks from Task Manager with optional filtering by status, priority, assignee, search query, or project.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search keyword matching title or description" },
        status: { type: "string", enum: ["all", "pending", "in-progress", "completed", "overdue"], description: "Filter by task status" },
        priority: { type: "string", enum: ["all", "high", "medium", "low"], description: "Filter by priority level" },
        assignee: { type: "string", description: "Filter tasks assigned to a specific person" },
        limit: { type: "number", description: "Maximum number of tasks to return (default 20, max 100)" },
      },
    },
  },
  {
    name: "get_task",
    description: "Retrieve complete details for a single task by ID or task number.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The MongoDB _id of the task" },
        taskNumber: { type: "number", description: "The human-readable task number (e.g. 104)" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task in Task Manager with title, description, priority, assignees, and due date.",
    inputSchema: {
      type: "object",
      required: ["title", "description"],
      properties: {
        title: { type: "string", description: "Title of the task" },
        description: { type: "string", description: "Detailed description of the task requirements" },
        priority: { type: "string", enum: ["high", "medium", "low"], default: "medium", description: "Priority level" },
        status: { type: "string", enum: ["pending", "in-progress", "completed"], default: "pending" },
        assignees: { type: "array", items: { type: "string" }, description: "Array of employee names to assign" },
        dueDate: { type: "string", description: "Due date in YYYY-MM-DD format" },
        dueTime: { type: "string", description: "Due time string (e.g. 5:00 PM)" },
        location: { type: "string", description: "Location or site for the task" },
      },
    },
  },
  {
    name: "update_task",
    description: "Update an existing task's status, priority, assignees, or description.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string", description: "The MongoDB _id or taskNumber of the task to update" },
        status: { type: "string", enum: ["pending", "in-progress", "completed", "overdue"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        description: { type: "string", description: "Updated task description" },
        assignees: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_projects",
    description: "List all active projects in Task Manager.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional project name search" },
        limit: { type: "number", description: "Maximum number of projects to return (default 25)" },
      },
    },
  },
  {
    name: "list_employees",
    description: "List active employees and team members in Task Manager with their roles and departments.",
    inputSchema: {
      type: "object",
      properties: {
        department: { type: "string", description: "Filter by department" },
        role: { type: "string", description: "Filter by role (admin, manager, employee)" },
        limit: { type: "number", description: "Maximum number of employees (default 50)" },
      },
    },
  },
  {
    name: "get_system_overview",
    description: "Get a high-level summary of tasks, projects, employees, and system statistics in Task Manager.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Tool handlers implementation
async function handleToolCall(name, args = {}) {
  await ensureDb();
  const { Task, Project, Employee, CRMFile } = getModels();

  switch (name) {
    case "list_tasks": {
      const filter = {};
      if (args.status && args.status !== "all") {
        filter.status = args.status;
      }
      if (args.priority && args.priority !== "all") {
        filter.priority = args.priority;
      }
      if (args.assignee) {
        filter.assignees = { $in: [args.assignee] };
      }
      if (args.search) {
        const regex = new RegExp(args.search, "i");
        filter.$or = [{ title: regex }, { description: regex }];
      }

      const limit = Math.min(Number(args.limit) || 20, 100);
      const tasks = await Task.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("taskNumber title description status priority assignees dueDate dueTime createdAt")
        .lean();

      return {
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
      };
    }

    case "get_task": {
      let query = null;
      if (args.taskId) {
        if (mongoose.Types.ObjectId.isValid(args.taskId)) {
          query = { _id: args.taskId };
        } else {
          const num = Number(args.taskId);
          if (!isNaN(num)) query = { taskNumber: num };
        }
      } else if (args.taskNumber) {
        query = { taskNumber: Number(args.taskNumber) };
      }

      if (!query) {
        throw new Error("Must provide either taskId or taskNumber");
      }

      const task = await Task.findOne(query).lean();
      if (!task) {
        throw new Error("Task not found");
      }

      return {
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
      };
    }

    case "create_task": {
      const last = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
      const nextTaskNumber = (last?.taskNumber || 0) + 1;

      const created = await Task.create({
        taskNumber: nextTaskNumber,
        title: args.title.trim(),
        description: args.description.trim(),
        priority: args.priority || "medium",
        status: args.status || "pending",
        assignees: Array.isArray(args.assignees) ? args.assignees : [],
        dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
        dueTime: args.dueTime || "",
        location: args.location || "",
        createdAt: new Date().toISOString().split("T")[0],
      });

      return {
        message: `Task #${created.taskNumber} created successfully`,
        taskId: String(created._id),
        taskNumber: created.taskNumber,
        title: created.title,
        status: created.status,
      };
    }

    case "update_task": {
      let query = null;
      if (mongoose.Types.ObjectId.isValid(args.taskId)) {
        query = { _id: args.taskId };
      } else {
        const num = Number(args.taskId);
        if (!isNaN(num)) query = { taskNumber: num };
      }

      if (!query) {
        throw new Error("Invalid taskId format");
      }

      const updateFields = {};
      if (args.status) updateFields.status = args.status;
      if (args.priority) updateFields.priority = args.priority;
      if (args.description) updateFields.description = args.description;
      if (args.assignees) updateFields.assignees = args.assignees;

      const updated = await Task.findOneAndUpdate(query, { $set: updateFields }, { new: true }).lean();
      if (!updated) {
        throw new Error("Task not found to update");
      }

      return {
        message: `Task #${updated.taskNumber} updated successfully`,
        task: {
          id: String(updated._id),
          taskNumber: updated.taskNumber,
          title: updated.title,
          status: updated.status,
          priority: updated.priority,
          assignees: updated.assignees,
        },
      };
    }

    case "list_projects": {
      const filter = {};
      if (args.search) {
        filter.name = new RegExp(args.search, "i");
      }
      const limit = Math.min(Number(args.limit) || 25, 100);
      const projects = await Project.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

      return {
        count: projects.length,
        projects: projects.map((p) => ({
          id: String(p._id),
          name: p.name,
          category: p.category || "general",
          description: p.description || "",
          tasksCount: (p.tasks || []).length,
          assignees: p.assignees || [],
        })),
      };
    }

    case "list_employees": {
      const filter = { status: "active" };
      if (args.department) filter.department = new RegExp(args.department, "i");
      if (args.role) filter.role = new RegExp(args.role, "i");

      const limit = Math.min(Number(args.limit) || 50, 150);
      const employees = await Employee.find(filter)
        .sort({ name: 1 })
        .limit(limit)
        .select("name email role department employeeId status")
        .lean();

      return {
        count: employees.length,
        employees: employees.map((e) => ({
          id: String(e._id),
          name: e.name,
          email: e.email || "",
          role: e.role || "employee",
          department: e.department || "General",
        })),
      };
    }

    case "get_system_overview": {
      const [totalTasks, pendingTasks, completedTasks, totalProjects, totalEmployees] = await Promise.all([
        Task.countDocuments(),
        Task.countDocuments({ status: { $in: ["pending", "in-progress"] } }),
        Task.countDocuments({ status: "completed" }),
        Project.countDocuments(),
        Employee.countDocuments({ status: "active" }),
      ]);

      return {
        timestamp: new Date().toISOString(),
        tasks: {
          total: totalTasks,
          activePending: pendingTasks,
          completed: completedTasks,
        },
        projectsCount: totalProjects,
        activeEmployeesCount: totalEmployees,
        serverStatus: "healthy",
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC stdio protocol loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: "2.0",
    id,
  };
  if (error) {
    response.error = {
      code: error.code || -32000,
      message: error.message || String(error),
    };
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + "\n");
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (err) {
    sendResponse(null, null, { code: -32700, message: "Parse error" });
    return;
  }

  const { id, method, params } = message;

  // Handle Notifications (no response required)
  if (id === undefined || id === null) {
    if (method === "notifications/initialized") {
      log("Client initialized MCP session.");
    }
    return;
  }

  try {
    switch (method) {
      case "initialize": {
        sendResponse(id, {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "task-manager-mcp-server",
            version: "1.0.0",
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
            resources: {
              subscribe: false,
              listChanged: false,
            },
          },
        });
        break;
      }

      case "ping": {
        sendResponse(id, {});
        break;
      }

      case "tools/list": {
        sendResponse(id, {
          tools: TOOLS,
        });
        break;
      }

      case "tools/call": {
        const { name, arguments: toolArgs } = params || {};
        try {
          const result = await handleToolCall(name, toolArgs);
          sendResponse(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: false,
          });
        } catch (callErr) {
          sendResponse(id, {
            content: [
              {
                type: "text",
                text: `Tool error: ${callErr.message}`,
              },
            ],
            isError: true,
          });
        }
        break;
      }

      case "resources/list": {
        sendResponse(id, {
          resources: [
            {
              uri: "taskmanager://system/overview",
              name: "Task Manager System Overview",
              description: "Live system overview of tasks and active projects",
              mimeType: "application/json",
            },
          ],
        });
        break;
      }

      default:
        sendResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
        break;
    }
  } catch (err) {
    sendResponse(id, null, {
      code: -32603,
      message: err.message || "Internal error",
    });
  }
});

log("Task Manager MCP Server started. Listening on stdio.");

