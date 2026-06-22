const os = require("os");
const http = require("http");
const https = require("https");
const { exec } = require("child_process");

// ----------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------
const SERVER_ID = process.env.SERVER_ID || "SERVER_REPLACE_ME";
const API_URL = process.env.API_URL || "http://localhost:5000/api/health/metrics/ingest";
const API_KEY = process.env.SERVER_AGENT_API_KEY || "default_agent_token_please_change";
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS) || 60000;

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------

let lastCpus = os.cpus();
function getCpuUsage() {
  return new Promise((resolve) => {
    setTimeout(() => {
      let currentCpus = os.cpus();
      let totalIdle = 0, totalTick = 0;

      for (let i = 0, len = currentCpus.length; i < len; i++) {
        let cpu = currentCpus[i];
        let lastCpu = lastCpus[i];
        
        for (let type in cpu.times) {
          totalTick += cpu.times[type] - lastCpu.times[type];
        }
        totalIdle += cpu.times.idle - lastCpu.times.idle;
      }
      
      let idle = totalIdle / currentCpus.length;
      let total = totalTick / currentCpus.length;
      let usage = 100 - ~~(100 * idle / total);
      
      lastCpus = currentCpus;
      resolve(usage);
    }, 100);
  });
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

function getDiskUsage() {
  return new Promise((resolve) => {
    const isWin = os.platform() === "win32";
    if (isWin) {
      exec("wmic logicaldisk get size,freespace,caption", (err, stdout) => {
        if (err) return resolve(0);
        const lines = stdout.split("\n").filter(l => l.trim().length > 0);
        let cDrive = lines.find(l => l.includes("C:"));
        if (!cDrive) return resolve(0);
        const parts = cDrive.trim().split(/\s+/);
        // caption, freespace, size
        const free = parseInt(parts[1], 10);
        const total = parseInt(parts[2], 10);
        if (!total) return resolve(0);
        resolve(Math.round(((total - free) / total) * 100));
      });
    } else {
      exec("df -k /", (err, stdout) => {
        if (err) return resolve(0);
        const lines = stdout.split("\n");
        if (lines.length < 2) return resolve(0);
        const parts = lines[1].trim().split(/\s+/);
        const usePercent = parts[4].replace("%", "");
        resolve(parseInt(usePercent, 10));
      });
    }
  });
}

function postMetrics(data) {
  const payload = JSON.stringify(data);
  const url = new URL(API_URL);
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "x-agent-token": API_KEY
    }
  };

  const client = url.protocol === "https:" ? https : http;
  
  const req = client.request(options, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`[${new Date().toISOString()}] Successfully posted metrics.`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to post metrics. Status: ${res.statusCode}`);
    }
  });

  req.on("error", (e) => {
    console.error(`[${new Date().toISOString()}] Error posting metrics: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ----------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------
async function run() {
  console.log(`Starting health agent for server ${SERVER_ID} targeting ${API_URL}...`);
  
  setInterval(async () => {
    try {
      const cpu = await getCpuUsage();
      const memory = getMemoryUsage();
      const disk = await getDiskUsage();
      
      postMetrics({
        serverId: SERVER_ID,
        cpu,
        memory,
        disk,
        networkIn: 0, // Placeholder
        networkOut: 0 // Placeholder
      });
    } catch (e) {
      console.error("Agent loop error:", e);
    }
  }, INTERVAL_MS);
}

run();
