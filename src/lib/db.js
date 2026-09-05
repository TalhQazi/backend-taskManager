const mongoose = require("mongoose");
const dns = require("dns");

// The public resolvers below were pinned to work around a broken resolver on the
// host. They are process-global and therefore affect every outbound lookup
// (S3, SMTP, external APIs) and break Docker service-name resolution, so they
// are now opt-out: set DNS_USE_SYSTEM_RESOLVER=true to fall back to the host's
// own resolver, which is usually faster.
if (String(process.env.DNS_USE_SYSTEM_RESOLVER || "").toLowerCase() !== "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}
dns.setDefaultResultOrder("ipv4first");

/**
 * Log any MongoDB command slower than this (ms).
 * The database is Docker-local, so healthy queries land in low single-digit
 * milliseconds — 50ms already indicates a collection scan or a missing index.
 */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 50);

// Commands that are noise in a slow-query log.
const IGNORED_COMMANDS = new Set(["ismaster", "hello", "ping", "endSessions", "getMore"]);

const queryStats = { total: 0, slow: 0, totalMs: 0 };

function attachCommandMonitoring(client) {
  const inFlight = new Map();

  client.on("commandStarted", (ev) => {
    if (IGNORED_COMMANDS.has(ev.commandName)) return;
    inFlight.set(ev.requestId, {
      name: ev.commandName,
      coll: ev.command?.[ev.commandName],
      startedAt: Date.now(),
    });
  });

  const finish = (ev, ok) => {
    const started = inFlight.get(ev.requestId);
    if (!started) return;
    inFlight.delete(ev.requestId);

    const ms = Date.now() - started.startedAt;
    queryStats.total += 1;
    queryStats.totalMs += ms;

    if (ms >= SLOW_QUERY_MS) {
      queryStats.slow += 1;
      const coll = typeof started.coll === "string" ? started.coll : "";
      console.warn(
        `[SLOW QUERY ${ms}ms] ${started.name}${coll ? ` ${coll}` : ""}${ok ? "" : " (failed)"}`
      );
    }
  };

  client.on("commandSucceeded", (ev) => finish(ev, true));
  client.on("commandFailed", (ev) => finish(ev, false));
}

function getQueryStats() {
  return {
    total: queryStats.total,
    slow: queryStats.slow,
    avgMs: queryStats.total ? Number((queryStats.totalMs / queryStats.total).toFixed(1)) : 0,
    slowThresholdMs: SLOW_QUERY_MS,
  };
}

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  mongoose.set("strictQuery", true);

  // Pool sizing: every gated request can issue several queries, so a pool of 10
  // becomes the concurrency ceiling under load — requests then queue *before*
  // they even reach the database. minPoolSize keeps connections warm, which
  // matters a great deal against a TLS-terminated remote cluster where a cold
  // connection costs a full handshake.
  const monitorCommands = String(process.env.DB_MONITOR_COMMANDS || "true").toLowerCase() === "true";

  await mongoose.connect(uri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL || 50),
    minPoolSize: Number(process.env.MONGO_MIN_POOL || 5),
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 10000,
    // Fail fast instead of hanging when the pool is saturated.
    waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 10000),
    // No wire compression: the database is a container on the same Docker
    // network, so compressing would spend CPU on both ends to save bytes that
    // never leave the host.
    monitorCommands,
  });

  if (monitorCommands) {
    attachCommandMonitoring(mongoose.connection.getClient());
    console.log(`[DB] slow-query logging enabled (>${SLOW_QUERY_MS}ms)`);
  }

  console.log(
    `[DB] MongoDB connected (pool: ${process.env.MONGO_MIN_POOL || 5}-${process.env.MONGO_MAX_POOL || 50})`
  );
}

module.exports = { connectDb, getQueryStats };
