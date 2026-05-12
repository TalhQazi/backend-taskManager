const express = require("express");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const { createServer } = require("http");
const { Server } = require("socket.io");
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
const vendorCategoriesRoutes = require("./routes/vendorCategories");
const trademarksRoutes = require("./routes/trademarks");
const travelCalendarRoutes = require("./routes/travelCalendar");
const dropboxRoutes = require("./routes/dropbox");
const shoppingListsRoutes = require("./routes/shoppingLists");
const clearhireRoutes = require("./routes/clearhire");
const systemSettingsRoutes = require("./routes/systemSettings");
const assetLibraryHeaderSettingsRoutes = require("./routes/assetLibraryHeaderSettings");
const memeRoutes = require("./routes/meme");

//going to express now
const app = express();
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

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

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

app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    return next();
  }
  // For other requests, use JSON parser
  express.json({ limit: "100mb" })(req, res, next);
});

// Gzip compression — reduces response sizes by 60-80%
app.use(compression());

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
const { requireAuth } = require("./middleware/auth");

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
app.use("/api/tasks", tasksRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/manager", eodReportsRoutes);
app.use("/api/admin", eodReportsRoutes);
app.use("/api/vehicles", vehiclesRoutes);
app.use("/api/time-entries", timeEntriesRoutes);
app.use("/api/appliances", appliancesRoutes);
app.use("/api/locations", locationsRoutes);
app.use("/api/do-not-hire", doNotHireRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/schedules", eventsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/notifications", messagesRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/vendors", vendorsRoutes);
app.use("/api/company-registry", companyRegistryRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/activity-logs", activityLogsRoutes);
app.use("/api/companies", companiesRoutes);
app.use("/api/asana-import", asanaImportRoutes);
app.use("/api/bugs", bugsRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/header-settings", headerSettingsRoutes);
app.use("/api/admin-info", adminInfoRoutes);
app.use("/api/websites", websitesRoutes);
app.use("/api/social-media", socialMediaRoutes);
app.use("/api/patents", patentsRoutes);
app.use("/api/credentials", credentialsRoutes);
app.use("/api/archive", archiveRoutes);
app.use("/api/team-lead-mappings", teamLeadMappingsRoutes);
app.use("/api/task-permissions", taskPermissionsRoutes);
app.use("/api/founder-messages", founderMessagesRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/asset-library", assetLibraryRoutes);
app.use("/api/contributors", contributorsRoutes);
app.use("/api/ui-preferences", uiPreferencesRoutes);
app.use("/api/vendor-categories", vendorCategoriesRoutes);
app.use("/api/trademarks", trademarksRoutes);
app.use("/api/travel-calendar", travelCalendarRoutes);
app.use("/api/dropbox", dropboxRoutes);
app.use("/api/shopping-lists", shoppingListsRoutes);
app.use("/api/email-accounts", emailAccountsRoutes);
app.use("/api/clearhire", clearhireRoutes);
app.use("/api/system-settings", systemSettingsRoutes);
app.use("/api/asset-library-header-settings", assetLibraryHeaderSettingsRoutes);
app.use("/api/meme", memeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT || 5000);

connectDb()
  .then(async () => {
    // Initialize Redis cache (graceful — falls back to memory if unavailable)
    await initRedis();
    
    // Initialize default founder messages
    await initializeMessages();

    // Start background reminders (Annual Reports)
    const { checkAnnualReportReminders } = require("./utils/reminders");
    checkAnnualReportReminders(); // Run once on startup
    setInterval(checkAnnualReportReminders, 24 * 60 * 60 * 1000); // Run every 24 hours
    
    httpServer.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
      console.log(`WebSocket server ready`);
    });
  })
  .catch((err) => {
    
    console.error("Failed to connect to DB", err);
    process.exit(1);
  });
