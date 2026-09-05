const cron = require("node-cron");
const axios = require("axios");
const pLimit = require("p-limit");
const https = require("https");
const Website = require("../models/Website");
const WebsiteCheck = require("../models/WebsiteCheck");
const WebsiteIncident = require("../models/WebsiteIncident");
const { dispatchAlert } = require("../utils/alertManager");

// Ensure we don't hold connections open indefinitely
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // We'll manually check SSL status
  keepAlive: false,
});

async function checkWebsite(website) {
  const startTime = Date.now();
  let status = "UNKNOWN";
  let statusCode = null;
  let errorDetails = "";
  let sslExpiryDate = null;
  let sslIssuer = "";
  let sslStatus = "UNKNOWN";

  try {
    const response = await axios.get(website.url, {
      timeout: 10000, // 10 seconds max
      httpsAgent,
      validateStatus: () => true, // resolve all status codes to handle 4xx/5xx manually
    });

    statusCode = response.status;
    const responseTimeMs = Date.now() - startTime;

    // Determine basic health status
    if (statusCode >= 200 && statusCode < 400) {
      status = responseTimeMs > 3000 ? "DEGRADED" : "LIVE"; // Degraded if slower than 3s
    } else {
      status = "DOWN";
      errorDetails = `HTTP Status: ${statusCode}`;
    }

    // Try to get SSL info if it's HTTPS
    if (website.url.startsWith("https") && response.request?.res?.socket) {
      const cert = response.request.res.socket.getPeerCertificate();
      if (cert && Object.keys(cert).length > 0) {
        sslExpiryDate = new Date(cert.valid_to);
        sslIssuer = cert.issuer?.O || cert.issuer?.CN || "Unknown";
        
        const daysToExpiry = (sslExpiryDate - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysToExpiry < 0) {
          sslStatus = "EXPIRED";
        } else if (daysToExpiry < 14) {
          sslStatus = "EXPIRING_SOON";
        } else {
          sslStatus = "VALID";
        }
      } else {
        sslStatus = "INVALID";
      }
    }

    return {
      status,
      statusCode,
      responseTimeMs,
      errorDetails,
      sslExpiryDate,
      sslIssuer,
      sslStatus
    };
  } catch (err) {
    status = "DOWN";
    errorDetails = err.code || err.message;
    return {
      status,
      statusCode: null,
      responseTimeMs: Date.now() - startTime,
      errorDetails,
      sslExpiryDate: null,
      sslIssuer: "",
      sslStatus: "UNKNOWN"
    };
  }
}

async function runMonitor() {
  console.log("[WebsiteMonitor] Starting check cycle...");
  
  const websites = await Website.find({
    websiteType: "active",
    isMonitoringEnabled: { $ne: false },
    url: { $exists: true, $ne: "" }
  });

  if (!websites.length) {
    console.log("[WebsiteMonitor] No active websites to monitor.");
    return;
  }

  // Limit to 5 concurrent requests to save resources
  const limit = pLimit(5);

  const checkPromises = websites.map(website => limit(async () => {
    const result = await checkWebsite(website);
    
    // Save the check log
    await WebsiteCheck.create({
      websiteId: website._id,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      errorDetails: result.errorDetails,
    });

    const previousStatus = website.healthStatus;

    // Update Website record
    website.healthStatus = result.status;
    website.lastCheckedAt = new Date();
    website.sslExpiryDate = result.sslExpiryDate;
    website.sslIssuer = result.sslIssuer;
    website.sslStatus = result.sslStatus;
    website.responseTimeMs = result.responseTimeMs;
    // Basic uptime calculation logic could go here; for now, keeping simple
    await website.save();

    // Handle Incidents
    if (result.status === "DOWN" || result.status === "DEGRADED") {
      // Check if open incident exists
      let openIncident = await WebsiteIncident.findOne({ websiteId: website._id, status: "OPEN" });
      
      if (!openIncident) {
        // Create new incident
        openIncident = await WebsiteIncident.create({
          websiteId: website._id,
          type: result.status,
          errorDetails: result.errorDetails,
        });

        // Trigger Alert
        await dispatchAlert(
          `[${result.status}] Website ${website.siteName}`,
          `Website ${website.siteName} (${website.url}) is currently ${result.status}.\nError: ${result.errorDetails || "None"}\nResponse Time: ${result.responseTimeMs}ms`,
          result.status
        );
      }
    } else if (result.status === "LIVE" && previousStatus && (previousStatus === "DOWN" || previousStatus === "DEGRADED")) {
      // Close open incident
      const openIncident = await WebsiteIncident.findOne({ websiteId: website._id, status: "OPEN" });
      if (openIncident) {
        openIncident.status = "RESOLVED";
        openIncident.resolvedAt = new Date();
        await openIncident.save();

        // Trigger Recovery Alert
        await dispatchAlert(
          `[RECOVERED] Website ${website.siteName}`,
          `Website ${website.siteName} (${website.url}) has recovered and is now LIVE.\nResponse Time: ${result.responseTimeMs}ms`,
          "RECOVERED"
        );
      }
    }

    // Handle SSL Expiry Alert
    if (result.sslStatus === "EXPIRING_SOON" || result.sslStatus === "EXPIRED") {
       // Avoid spamming this alert every minute. Check if we already alerted recently (e.g. within 24h).
       // We can store an incident for SSL_ISSUE to track it.
       const openSslIncident = await WebsiteIncident.findOne({ websiteId: website._id, type: "SSL_ISSUE", status: "OPEN" });
       if (!openSslIncident) {
         await WebsiteIncident.create({
           websiteId: website._id,
           type: "SSL_ISSUE",
           errorDetails: `SSL Status: ${result.sslStatus}`,
         });
         await dispatchAlert(
           `[SSL WARNING] Website ${website.siteName}`,
           `Website ${website.siteName} (${website.url}) SSL Certificate is ${result.sslStatus}.\nExpiry Date: ${result.sslExpiryDate}`,
           "SSL_EXPIRING"
         );
       }
    } else if (result.sslStatus === "VALID") {
        const openSslIncident = await WebsiteIncident.findOne({ websiteId: website._id, type: "SSL_ISSUE", status: "OPEN" });
        if (openSslIncident) {
          openSslIncident.status = "RESOLVED";
          openSslIncident.resolvedAt = new Date();
          await openSslIncident.save();
        }
    }

  }));

  await Promise.all(checkPromises);
  console.log(`[WebsiteMonitor] Completed check cycle for ${websites.length} websites.`);

  // Monitor Servers for offline timeout (no metrics for > 5 minutes)
  try {
    const Server = require("../models/Server");
    const servers = await Server.find({ isMonitoringEnabled: { $ne: false } });
    
    for (const server of servers) {
      const previousStatus = server.status || "UNKNOWN";
      let currentStatus = previousStatus;
      
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (!server.lastSeenAt || server.lastSeenAt < fiveMinutesAgo) {
        currentStatus = "DOWN";
      } else if (server.status === "DOWN") {
        currentStatus = "LIVE";
      }
      
      if (currentStatus !== previousStatus) {
        server.status = currentStatus;
        await server.save();
      }
      
      if (currentStatus === "DOWN") {
        let openIncident = await WebsiteIncident.findOne({ 
          serverId: server._id, 
          status: "OPEN" 
        });
        
        if (!openIncident) {
          openIncident = await WebsiteIncident.create({
            serverId: server._id,
            type: "DOWN",
            errorDetails: "Server hasn't reported metrics in over 5 minutes.",
          });
          
          await dispatchAlert(
            `[DOWN] Server ${server.name}`,
            `Server ${server.name} (${server.ipAddress || "Unknown IP"}) hasn't reported metrics in over 5 minutes and is currently DOWN.`,
            "DOWN"
          );
        }
      } else if (currentStatus === "LIVE" && previousStatus === "DOWN") {
        const openIncident = await WebsiteIncident.findOne({ 
          serverId: server._id, 
          status: "OPEN" 
        });
        if (openIncident) {
          openIncident.status = "RESOLVED";
          openIncident.resolvedAt = new Date();
          await openIncident.save();
          
          await dispatchAlert(
            `[RECOVERED] Server ${server.name}`,
            `Server ${server.name} (${server.ipAddress || "Unknown IP"}) has recovered and is now LIVE.`,
            "RECOVERED"
          );
        }
      }
    }
  } catch (err) {
    console.error("[WebsiteMonitor] Error monitoring servers:", err);
  }
}

// Start cron job (every minute)
function startWebsiteMonitor() {
  cron.schedule("* * * * *", () => {
    runMonitor().catch(err => console.error("Error running WebsiteMonitor:", err));
  });
  console.log("[WebsiteMonitor] Cron job started.");
}

module.exports = { startWebsiteMonitor, runMonitor };
