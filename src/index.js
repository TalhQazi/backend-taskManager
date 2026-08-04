const express = require("express");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const { createServer } = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { connectDb } = require("./lib/db");
const { initRedis } = require("./lib/cache");
const { notFoundHandler, errorHandler } = require("./middleware/error");

const authRoutes = require("./routes/auth");
const tasksRoutes = require("./routes/tasks");
const employeesRoutes = require("./routes/employees");
const vehiclesRoutes = require("./routes/vehicles");
const timeEntriesRoutes = require("./routes/timeEntries");
const appliancesRoutes = require("./routes/appliances");
const locationsRoutes = require("./routes/locations");
const doNotHireRoutes = require("./routes/doNotHire");
const eventsRoutes = require("./routes/events");
const messagesRoutes = require("./routes/messages");
const onboardingRoutes = require("./routes/onboarding");
const settingsRoutes = require("./routes/settings");
const reportsRoutes = require("./routes/reports");
const usersRoutes = require("./routes/users");
const dashboardRoutes = require("./routes/dashboard");
const vendorsRoutes = require("./routes/vendors");
const companyRegistryRoutes = require("./routes/companyRegistry");
const complianceRoutes = require("./routes/compliance");
const activityLogsRoutes = require("./routes/activityLogs");
const companiesRoutes = require("./routes/companies");
const asanaImportRoutes = require("./routes/asanaImport");
const bugsRoutes = require("./routes/bugs");
const projectsRoutes = require("./routes/projects");
const headerSettingsRoutes = require("./routes/headerSettings");
const adminInfoRoutes = require("./routes/adminInfo");
const websitesRoutes = require("./routes/websites");
const socialMediaRoutes = require("./routes/socialMedia");
const patentsRoutes = require("./routes/patents");
const credentialsRoutes = require("./routes/credentials");
const archiveRoutes = require("./routes/archive");
const teamLeadMappingsRoutes = require("./routes/teamLeadMappings");
const taskPermissionsRoutes = require("./routes/taskPermissions");
const { router: founderMessagesRoutes, initializeMessages } = require("./routes/founderMessages");
const notesRoutes = require("./routes/notes");
const assetLibraryRoutes = require("./routes/assetLibrary");
const contributorsRoutes = require("./routes/contributors");
const eodReportsRoutes = require("./routes/eodReports");
const emailAccountsRoutes = require("./routes/emailAccounts");
const uiPreferencesRoutes = require("./routes/uiPreferences");
const { router: videoMessagesRoutes, historyRouter: videoUserHistoryRoutes } = require("./routes/videoMessages");
const vendorCategoriesRoutes = require("./routes/vendorCategories");
const trademarksRoutes = require("./routes/trademarks");
const travelCalendarRoutes = require("./routes/travelCalendar");
const dropboxRoutes = require("./routes/dropbox");
const shoppingListsRoutes = require("./routes/shoppingLists");
const leaveRequestsRoutes = require("./routes/leaveRequests");
const clearhireRoutes = require("./routes/clearhire");
const systemSettingsRoutes = require("./routes/systemSettings");
const assetLibraryHeaderSettingsRoutes = require("./routes/assetLibraryHeaderSettings");
const emailRoutes = require("./routes/email");
const userStatusRoutes = require("./routes/userStatus");
const itinerariesRoutes = require("./routes/itineraries");
const followUpsRoutes = require("./routes/followUps");
const newHireReportsRoutes = require("./routes/newHireReports");
const globalSearchRoutes = require("./routes/globalSearch");

const legalCaseRoutes = require("./routes/LegalCase");
const legalCourtRoutes = require("./routes/LegalCourt");
const legalDocumentRoutes = require("./routes/LegalDocument");
const legalEvidenceRoutes = require("./routes/LegalEvidence");
const legalDeadlineRoutes = require("./routes/LegalDeadline");
const legalCalendarRoutes = require("./routes/LegalCalendar");
const legalContactRoutes = require("./routes/LegalContact");
const legalTaskRoutes = require("./routes/LegalTask");
const legalNoteRoutes = require("./routes/LegalNote");
const legalReportRoutes = require("./routes/LegalReport");
const legalFilingRoutes = require("./routes/LegalFiling");
const legalNotificationRoutes = require("./routes/LegalNotification");

const crmCompanyRoutes = require("./routes/crmcompany");
const crmContactsRoutes = require("./routes/crmcontacts");
const crmDealsRoutes = require("./routes/crmdeals");
const crmTasksRoutes = require("./routes/crmtasks");
const crmDashboardRoutes = require("./routes/crmdashboard");
const crmCommandCoreRoutes = require("./routes/crmcommandcore");
const crmFilesRoutes = require("./routes/crmfiles");
const crmCommunicationRoutes = require("./routes/crmcommunication");

const memeRoutes = require("./routes/meme");

const announcementsRoutes = require("./routes/announcements");

const milestonesRoutes = require("./routes/milestones");
const costManagerRoutes = require("./routes/costManager");
const atlasbookRoutes = require("./routes/atlasbook");
const personalBudgetRoutes = require("./routes/personalBudget");
const healthRoutes = require("./routes/health");



//going to express now
const app = express();
app.set("trust proxy", true);
const httpServer = createServer(app);



// Socket.io setup
const io = new Server(httpServer, {
  path: "/api/socket.io/",
  cors: {
    origin: (origin, callback) => {
      const configuredOrigins = (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      
      configuredOrigins.push(
        "https://bug-panel.vercel.app", 
        "http://localhost:3001",
        "https://task.se7eninc.com",
        "http://localhost:8080",
        "http://192.168.31.13:8080"
      );
      
      if (!origin) return callback(null, true);
      if (configuredOrigins.length === 0) return callback(null, true);
      const isAllowed = 
        configuredOrigins.includes("*") || 
        configuredOrigins.some(o => origin === o || origin.replace(/\/$/, "") === o.replace(/\/$/, ""));

      if (isAllowed) return callback(null, true);
      
      // Always allow localhost/127.0.0.1 for local development
      try {
        const { hostname } = new URL(origin);
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {
        // ignore invalid origins
      }
      
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  },
});

// Store io instance globally so routes can access it
global.io = io;

/**
 * Verify the JWT on the socket handshake and stash the identity on the socket.
 *
 * The legacy `register-user` event trusts client-supplied username/role. That
 * is tolerable for the pre-existing comment rooms, but must never gate WIP
 * rooms — those carry manager-only data. WIP rooms are joined server-side
 * below, from the verified token only. Unauthenticated sockets still connect
 * (preserving existing behaviour); they simply never get a WIP room.
 */
io.use((socket, next) => {
  const raw =
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!raw) return next();
  try {
    const payload = jwt.verify(String(raw), process.env.JWT_SECRET);
    socket.data.auth = {
      employeeId: String(payload.sub || payload.id || payload._id || ""),
      role: String(payload.role || "").trim().toLowerCase(),
      name: payload.name || "",
      username: payload.username || "",
    };
  } catch {
    // Bad/expired token: connect anonymously rather than dropping the socket.
  }
  return next();
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // --- WIP rooms: derived from the verified JWT, never from client input. ---
  const wipAuth = socket.data?.auth;
  if (wipAuth?.employeeId) {
    const { WIP_ROOMS, OWNER_ROLES, MANAGER_ROLES } = require("./constants/wip");
    const isPrivileged = [...OWNER_ROLES, ...MANAGER_ROLES].includes(wipAuth.role);

    socket.join(WIP_ROOMS.employee(wipAuth.employeeId));
    if (isPrivileged) socket.join(WIP_ROOMS.MANAGERS);

    // Read-only TV displays opt in explicitly; they receive grid/summary only.
    socket.on("wip:join-tv", () => {
      if (isPrivileged) socket.join(WIP_ROOMS.TV);
    });
    socket.on("wip:join-session", (sessionId) => {
      if (sessionId) socket.join(WIP_ROOMS.session(sessionId));
    });
    socket.on("wip:leave-session", (sessionId) => {
      if (sessionId) socket.leave(WIP_ROOMS.session(sessionId));
    });
  }

  // Register user into their personal room + role room for targeted notification delivery.
  // `name` is the display name room — needed so @mentions (which use display names) reach
  // admin/manager sockets that are keyed by email username.
  socket.on("register-user", ({ username, role, name } = {}) => {
    if (username) {
      socket.join(username);
      console.log(`Socket ${socket.id} registered as user: ${username}`);
    }
    if (name && name !== username) {
      socket.join(name);
      console.log(`Socket ${socket.id} joined display-name room: ${name}`);
    }
    if (role) {
      socket.join(role);
      console.log(`Socket ${socket.id} joined role room: ${role}`);
    }
  });

  // Join group room
  socket.on("join-group", (groupId) => {
    if (groupId) {
      socket.join(`group-${groupId}`);
      console.log(`Socket ${socket.id} joined group-${groupId}`);
    }
  });

  // Leave group room
  socket.on("leave-group", (groupId) => {
    if (groupId) {
      socket.leave(`group-${groupId}`);
      console.log(`Socket ${socket.id} left group-${groupId}`);
    }
  });

  // Handle group typing indicator
  socket.on("group-typing", ({ groupId, username }) => {
    if (groupId) {
      socket.to(`group-${groupId}`).emit("group-typing", { groupId, username });
    }
  });

  // Handle group stop typing indicator
  socket.on("stop-group-typing", ({ groupId, username }) => {
    if (groupId) {
      socket.to(`group-${groupId}`).emit("stop-group-typing", { groupId, username });
    }
  });

  // Handle direct message typing indicator
  socket.on("direct-typing", ({ recipient, username }) => {
    if (recipient) {
      socket.to(recipient).emit("direct-typing", { username });
    }
  });

  socket.on("stop-direct-typing", ({ recipient, username }) => {
    if (recipient) {
      socket.to(recipient).emit("stop-direct-typing", { username });
    }
  });

  // Join task-specific room for receiving real-time comments
  socket.on("join-task", (taskId) => {
    if (taskId) {
      socket.join(`task-${taskId}`);
      console.log(`Socket ${socket.id} joined task-${taskId}`);
    }
  });

  // Leave task room
  socket.on("leave-task", (taskId) => {
    if (taskId) {
      socket.leave(`task-${taskId}`);
      console.log(`Socket ${socket.id} left task-${taskId}`);
    }
  });

  // Join project-specific room for receiving real-time project comments
  socket.on("join-project", (projectId) => {
    if (projectId) {
      socket.join(`project-${projectId}`);
      console.log(`Socket ${socket.id} joined project-${projectId}`);
    }
  });

  // Leave project room
  socket.on("leave-project", (projectId) => {
    if (projectId) {
      socket.leave(`project-${projectId}`);
      console.log(`Socket ${socket.id} left project-${projectId}`);
    }
  });

  // Handle typing indicator
  socket.on("typing", ({ taskId, username }) => {
    socket.to(`task-${taskId}`).emit("typing", { taskId, username });
  });

  // Handle stop typing
  socket.on("stop-typing", ({ taskId }) => {
    socket.to(`task-${taskId}`).emit("stop-typing", { taskId });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const uploadsDir = path.resolve(__dirname, "..", "uploads");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

configuredOrigins.push(
  "https://bug-panel.vercel.app", 
  "http://localhost:3001",
  "https://task.se7eninc.com"
);

const isDev = String(process.env.NODE_ENV || "").toLowerCase() !== "production";

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (configuredOrigins.length === 0) return callback(null, true);
      const isAllowed = 
        configuredOrigins.includes("*") || 
        configuredOrigins.some(o => origin === o || origin.replace(/\/$/, "") === o.replace(/\/$/, ""));

      if (isAllowed) return callback(null, true);

      // Always allow localhost/127.0.0.1 for local development against any backend
      try {
        const { hostname } = new URL(origin);
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {
        // ignore invalid origins
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Timing first so it measures the full middleware chain, not just the handler.
const { requestTiming } = require("./middleware/requestTiming");
app.use(requestTiming);

// Gzip compression — reduces response sizes by 60-80%.
// Registered ahead of the body parser so it also wraps responses from routes
// that short-circuit before parsing (static assets, early 4xx).
app.use(compression());

const jsonParser = express.json({ limit: "100mb" });
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    return next();
  }
  // Methods without a body never need the parser — skip the work entirely.
  if (req.method === "GET" || req.method === "HEAD") {
    return next();
  }
  // For other requests, use JSON parser
  jsonParser(req, res, next);
});

// Only log in development (morgan is noisy in production)
if (isDev) {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined", {
    skip: (req) => req.method === "GET" && req.url === "/health",
  }));
}

app.use("/uploads", express.static(uploadsDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// S3 Proxy endpoint — serves S3 files through the backend to avoid CORS/OpaqueResponseBlocking issues
const { getFromS3 } = require("./lib/s3");
const { requireAuth, requireClearHire } = require("./middleware/auth");

app.get("/api/s3-proxy/*", requireAuth, async (req, res) => {
  try {
    // Extract the S3 key from the URL path after /api/s3-proxy/
    const s3Key = req.params[0];
    if (!s3Key) {
      return res.status(400).json({ error: { message: "Missing S3 key" } });
    }

    const { stream, contentType, contentLength } = await getFromS3(s3Key);

    // Set proper headers for caching and content type
    res.set("Content-Type", contentType);
    if (contentLength) {
      res.set("Content-Length", String(contentLength));
    }
    res.set("Cache-Control", "public, max-age=86400, immutable"); // Cache for 24h
    res.set("Access-Control-Allow-Origin", "*");

    // Pipe the S3 stream directly to the response
    stream.pipe(res);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: { message: "File not found" } });
    }
    console.error("[S3 Proxy] Error:", err.message || err);
    return res.status(500).json({ error: { message: "Failed to fetch file" } });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/clearhire", clearhireRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/employees", employeesRoutes); // left open to allow profile checks during onboarding

app.use("/api/tasks", requireClearHire, tasksRoutes);
app.use("/api/manager", requireClearHire, eodReportsRoutes);
app.use("/api/admin", requireClearHire, eodReportsRoutes);
app.use("/api/vehicles", requireClearHire, vehiclesRoutes);
app.use("/api/time-entries", requireClearHire, timeEntriesRoutes);
app.use("/api/appliances", requireClearHire, appliancesRoutes);
app.use("/api/locations", requireClearHire, locationsRoutes);
app.use("/api/do-not-hire", requireClearHire, doNotHireRoutes);
app.use("/api/events", requireClearHire, eventsRoutes);
app.use("/api/schedules", requireClearHire, eventsRoutes);
app.use("/api/messages", requireClearHire, messagesRoutes);
app.use("/api/notifications", requireClearHire, messagesRoutes);
app.use("/api/settings", requireClearHire, settingsRoutes);
app.use("/api/reports", requireClearHire, reportsRoutes);
app.use("/api/users", requireClearHire, usersRoutes);
app.use("/api/dashboard", requireClearHire, dashboardRoutes);
app.use("/api/vendors", requireClearHire, vendorsRoutes);
app.use("/api/company-registry", requireClearHire, companyRegistryRoutes);
app.use("/api/compliance", requireClearHire, complianceRoutes);
app.use("/api/activity-logs", requireClearHire, activityLogsRoutes);
app.use("/api/companies", requireClearHire, companiesRoutes);
app.use("/api/asana-import", requireClearHire, asanaImportRoutes);
app.use("/api/bugs", requireClearHire, bugsRoutes);
app.use("/api/projects", requireClearHire, projectsRoutes);
app.use("/api/header-settings", requireClearHire, headerSettingsRoutes);
app.use("/api/admin-info", requireClearHire, adminInfoRoutes);
app.use("/api/websites", requireClearHire, websitesRoutes);
app.use("/api/social-media", requireClearHire, socialMediaRoutes);
app.use("/api/patents", requireClearHire, patentsRoutes);
app.use("/api/credentials", requireClearHire, credentialsRoutes);
app.use("/api/archive", requireClearHire, archiveRoutes);
app.use("/api/team-lead-mappings", requireClearHire, teamLeadMappingsRoutes);
app.use("/api/task-permissions", requireClearHire, taskPermissionsRoutes);
app.use("/api/founder-messages", requireClearHire, founderMessagesRoutes);
app.use("/api/notes", requireClearHire, notesRoutes);

// Knowledge Vault v2 — additive module, always mounted. Wrapped in try/catch so
// a load error could never crash server startup.
try {
  app.use("/api/knowledge/v2", requireClearHire, require("./routes/knowledge"));
  console.log("[Knowledge Vault] v2 API mounted at /api/knowledge/v2");
} catch (err) {
  console.error("[Knowledge Vault] failed to mount v2 API:", err.message);
}

// Task Management multi-view upgrade — additive routes for the new views.
// Reuses existing /api/tasks; these add dependencies, capacity, saved views and
// read-only analytics. Wrapped so a load error can't crash startup.
try {
  app.use("/api/task-dependencies", requireClearHire, require("./routes/taskDependencies"));
  app.use("/api/employee-capacity", requireClearHire, require("./routes/employeeCapacity"));
  app.use("/api/task-saved-views", requireClearHire, require("./routes/taskSavedViews"));
  app.use("/api/task-analytics", requireClearHire, require("./routes/taskAnalytics"));
  console.log("[Task Views] analytics/dependencies/capacity/saved-views mounted");
} catch (err) {
  console.error("[Task Views] failed to mount routes:", err.message);
}
app.use("/api/asset-library", requireClearHire, assetLibraryRoutes);
app.use("/api/contributors", requireClearHire, contributorsRoutes);
app.use("/api/ui-preferences", requireClearHire, uiPreferencesRoutes);
app.use("/api/vendor-categories", requireClearHire, vendorCategoriesRoutes);
app.use("/api/trademarks", requireClearHire, trademarksRoutes);
app.use("/api/travel-calendar", requireClearHire, travelCalendarRoutes);
app.use("/api/dropbox", requireClearHire, dropboxRoutes);
app.use("/api/shopping-lists", requireClearHire, shoppingListsRoutes);
app.use("/api/leave-requests", requireClearHire, leaveRequestsRoutes);
app.use("/api/email-accounts", requireClearHire, emailAccountsRoutes);
app.use("/api/system-settings", requireClearHire, systemSettingsRoutes);
app.use("/api/asset-library-header-settings", requireClearHire, assetLibraryHeaderSettingsRoutes);
app.use("/api/email", requireClearHire, emailRoutes);
app.use("/api/user", requireClearHire, userStatusRoutes);
app.use("/api/team", requireClearHire, userStatusRoutes);
app.use("/api/itineraries", requireClearHire, itinerariesRoutes);
app.use("/api/tasks", requireClearHire, followUpsRoutes);
app.use("/api/new-hire-reports", requireClearHire, newHireReportsRoutes);

app.use("/api/crm-company", requireClearHire, crmCompanyRoutes);
app.use("/api/crm-contacts", requireClearHire, crmContactsRoutes);
app.use("/api/crm-deals", requireClearHire, crmDealsRoutes);
app.use("/api/crm-tasks", requireClearHire, crmTasksRoutes);
app.use("/api/crm-dashboard", requireClearHire, crmDashboardRoutes);
app.use("/api/crm-commandcore", requireClearHire, crmCommandCoreRoutes);
app.use("/api/crm-files", requireClearHire, crmFilesRoutes);
app.use("/api/crm-communication", requireClearHire, crmCommunicationRoutes);
app.use("/api/meme", requireClearHire, memeRoutes);

app.use("/api/legal/cases", requireClearHire, legalCaseRoutes);
app.use("/api/legal/courts", requireClearHire, legalCourtRoutes);
app.use("/api/legal/documents", requireClearHire, legalDocumentRoutes);
app.use("/api/legal/evidence", requireClearHire, legalEvidenceRoutes);
app.use("/api/legal/deadlines", requireClearHire, legalDeadlineRoutes);
app.use("/api/legal/calendar", requireClearHire, legalCalendarRoutes);
app.use("/api/legal/contacts", requireClearHire, legalContactRoutes);
app.use("/api/legal/tasks", requireClearHire, legalTaskRoutes);
app.use("/api/legal/notes", requireClearHire, legalNoteRoutes);
app.use("/api/legal/reports", requireClearHire, legalReportRoutes);
app.use("/api/legal/filings", requireClearHire, legalFilingRoutes);
app.use("/api/legal/notifications", requireClearHire, legalNotificationRoutes);

app.use("/api/announcements", requireClearHire, announcementsRoutes);

app.use("/api/milestones", requireClearHire, milestonesRoutes);
app.use("/api/cost-manager", requireClearHire, costManagerRoutes);
app.use("/api/video", requireClearHire, videoMessagesRoutes);
app.use("/api/user", requireClearHire, videoUserHistoryRoutes);
app.use("/api/atlasbook", requireClearHire, atlasbookRoutes);
app.use("/api/personal-budget", requireClearHire, personalBudgetRoutes);
app.use("/api/global-search", requireClearHire, globalSearchRoutes);
app.use("/api/health", healthRoutes);

// --- WIP Dashboard ---------------------------------------------------------
// Mounted on three namespaces so the public API matches the spec exactly.
// `taskRouter` is added *after* the existing tasks routes so it only handles
// the two paths it declares and never shadows them.
const { dashboardRouter, sessionRouter, blockerRouter, taskRouter } = require("./routes/wip");
app.use("/api/dashboard/wip", dashboardRouter);
app.use("/api/work-sessions", sessionRouter);
app.use("/api/blockers", blockerRouter);
app.use("/api/tasks", taskRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT || 5000);

connectDb()
  .then(async () => {
    // Run S3 to Local Server migration script
    try {
      const { migrateS3ToLocalServer } = require("./utils/s3Migration");
      migrateS3ToLocalServer().catch((err) => console.error("[S3 Migration Startup Error]:", err));
    } catch (migErr) {
      console.error("[S3 Migration Startup Import Error]:", migErr);
    }

    // Initialize Redis cache (graceful — falls back to memory if unavailable)
    await initRedis();
    
    // Initialize default founder messages
    await initializeMessages();

    // Rename existing "UPH-Server" or "UPH Server" to "Se7en" in the Database
    try {
      const ServerModel = require("./models/Server");
      const renameResult = await ServerModel.updateMany(
        { name: { $in: ["UPH-Server", "UPH Server"] } },
        { name: "Se7en" }
      );
      if (renameResult.modifiedCount > 0) {
        console.log(`[Startup Migration] Renamed ${renameResult.modifiedCount} Server instances from UPH Server to Se7en.`);
      }
    } catch (migErr) {
      console.error("[Startup Migration] Error renaming UPH-Server:", migErr);
    }

    // Archive existing completed tasks on startup
    try {
      const Archive = require("./models/Archive");
      const Task = require("./models/Task");
      const completedTasks = await Task.find({ status: "completed" }).lean();
      if (completedTasks.length > 0) {
        console.log(`[Startup Migration] Archiving ${completedTasks.length} existing completed tasks...`);
        // Batched rather than two round-trips per task. Same end state, but
        // startup no longer scales linearly with the completed-task backlog —
        // the server was previously unreachable for the whole loop.
        const BATCH = 500;
        for (let i = 0; i < completedTasks.length; i += BATCH) {
          const chunk = completedTasks.slice(i, i + BATCH);
          await Archive.insertMany(
            chunk.map((task) => ({
              itemType: "task",
              originalId: task._id,
              archivedBy: "system",
              data: task,
            })),
            { ordered: false }
          );
          await Task.deleteMany({ _id: { $in: chunk.map((t) => t._id) } });
        }
        console.log(`[Startup Migration] Finished archiving completed tasks.`);
      }
    } catch (migErr) {
      console.error("[Startup Migration] Error archiving completed tasks:", migErr);
    }

    // Initialize default compliance templates
    const { initializeComplianceTemplates } = require("./utils/complianceSeeder");
    await initializeComplianceTemplates();

    // Initialize default alert rules
    const { initializeAlertRules } = require("./utils/alertRuleSeeder");
    await initializeAlertRules();

    // Start background reminders (Annual Reports)
    const { checkAnnualReportReminders } = require("./utils/reminders");
    checkAnnualReportReminders(); // Run once on startup
    setInterval(checkAnnualReportReminders, 24 * 60 * 60 * 1000); // Run every 24 hours

    // Start background reminders (Patent Expirations)
    const { checkPatentExpirations } = require("./jobs/expiryJob");
    checkPatentExpirations().catch((err) => console.error("[Expiry Job] Startup run failed:", err));
    setInterval(() => {
      checkPatentExpirations().catch((err) => console.error("[Expiry Job] Interval run failed:", err));
    }, 24 * 60 * 60 * 1000); // Run every 24 hours

    // Start background follow-up timers cron worker
    const { processFollowUpTimers } = require("./jobs/followUpJob");
    processFollowUpTimers().catch((err) => console.error("[Follow-Up Job] Startup run failed:", err));
    setInterval(() => {
      processFollowUpTimers().catch((err) => console.error("[Follow-Up Job] Interval run failed:", err));
    }, 60 * 1000);

    // Start background New Hire submissions cron worker
    const { processNewHireSubmissions } = require("./jobs/newHireJob");
    processNewHireSubmissions().catch((err) => console.error("[New Hire Job] Startup run failed:", err));
    setInterval(() => {
      processNewHireSubmissions().catch((err) => console.error("[New Hire Job] Interval run failed:", err));
    }, 60 * 1000);

    // Start Cost Manager alert worker (purchased-not-stored, certification deadlines)
    const { runCostManagerChecks } = require("./jobs/costManagerJob");
    runCostManagerChecks().catch((err) => console.error("[Cost Manager Job] Startup run failed:", err));
    setInterval(() => {
      runCostManagerChecks().catch((err) => console.error("[Cost Manager Job] Interval run failed:", err));
    }, 6 * 60 * 60 * 1000);

    // Initialize announcement scheduler
    const { runAllTasks: runAnnouncementScheduler } = require("./lib/announcementScheduler");
    runAnnouncementScheduler().catch((err) => console.error("[Announcements] Startup scheduler error:", err));
    // Run announcement scheduler every 5 minutes
    setInterval(
      () => {
        runAnnouncementScheduler().catch((err) => console.error("[Announcements] Scheduler error:", err));
      },
      5 * 60 * 1000
    );
    // Start background status expiry scheduler
    const { checkStatusExpiry } = require("./jobs/statusExpiryJob");
    checkStatusExpiry().catch((err) => console.error("[Status Expiry] Startup check error:", err));
    // Run status expiry check every 30 seconds
    setInterval(
      () => {
        checkStatusExpiry().catch((err) => console.error("[Status Expiry] Interval check error:", err));
      },
      30 * 1000
    );

    // Start Website Monitor cron job
    const { startWebsiteMonitor } = require("./jobs/websiteMonitor");
    startWebsiteMonitor();

    // Start WIP idle sweep + heartbeat rollup (every 60s).
    // Also probes transaction support once and warns loudly on a standalone.
    const { startWipIdleMonitor } = require("./jobs/wipIdleMonitor");
    startWipIdleMonitor();
    require("./lib/withTransaction")
      .detectTransactionSupport()
      .then((ok) => console.log(`[WIP] transactions ${ok ? "supported (replica set)" : "UNAVAILABLE (standalone)"}`))
      .catch(() => {});

    // Start background EOD Miss check job
    const eodMissCheckJob = require("./jobs/eodMissCheckJob");
    eodMissCheckJob.run().catch((err) => console.error("[EOD Miss Job] Startup run failed:", err));
    setInterval(() => {
      eodMissCheckJob.run().catch((err) => console.error("[EOD Miss Job] Interval run failed:", err));
    }, 15 * 60 * 1000); // Check every 15 minutes
    
    httpServer.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
      console.log(`WebSocket server ready`);
    });
  })
  .catch((err) => {
    
    console.error("Failed to connect to DB", err);
    process.exit(1);
  });
