const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const { createServer } = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const http = require("http");


const { connectDb } = require("./lib/db");
const { notFoundHandler, errorHandler } = require("./middleware/error");
const { auditLogMiddleware } = require("./middleware/auditLog");

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
  express.json({ limit: "50mb" })(req, res, next);
 
});
 app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));

app.use(auditLogMiddleware());

app.use("/uploads", express.static(uploadsDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/employees", employeesRoutes);
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

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT || 5001);

connectDb()
  .then(() => {
    const server = httpServer.listen(port, () => {
      console.log(`✅ Backend listening on http://localhost:${port}`);
      console.log(`✅ WebSocket server ready`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`❌ Port ${port} is busy. Trying 5002...`);
        httpServer.listen(5002, () => {
          console.log(`✅ Backend switched to http://localhost:5002`);
        });
      } else {
        console.error(err);
      }
    });
  })
  .catch((err) => {
    console.error("Failed to connect to DB", err);
    process.exit(1);
  });