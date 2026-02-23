const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const { connectDb } = require("./lib/db");
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

const app = express();

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isDev = String(process.env.NODE_ENV || "").toLowerCase() !== "production";

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (configuredOrigins.length === 0) return callback(null, true);
      if (configuredOrigins.includes("*")) return callback(null, true);
      if (configuredOrigins.includes(origin)) return callback(null, true);

      if (isDev) {
        try {
          const { hostname } = new URL(origin);
          if (hostname === "localhost" || hostname === "127.0.0.1") {
            return callback(null, true);
          }
        } catch {
         
        }
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

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

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT || 5000);

connectDb()
  .then(() => {
    app.listen(port, () => {
    
      console.log(`Backend listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    
    console.error("Failed to connect to DB", err);
    process.exit(1);
  });
