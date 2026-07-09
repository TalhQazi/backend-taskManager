/**
 * Storage telemetry service.
 *
 * Collects physical-drive & RAID health for a server and normalizes everything
 * into a single payload consumed by the Super Admin "Storage Health" card.
 *
 * On Linux hosts it shells out to the standard tooling when available:
 *   lsblk           -> block-device inventory
 *   smartctl        -> SMART health / temperature / power-on hours
 *   iostat          -> per-device read/write throughput
 *   df              -> filesystem utilization
 *   storcli/perccli -> PERC / MegaRAID controller + virtual-disk state
 *
 * Each collector is wrapped in a guarded exec with a short timeout so a missing
 * binary or a non-Linux host never throws — it simply degrades. When no real
 * data can be gathered (Windows dev box, no RAID controller, restricted perms)
 * the service returns a deterministic simulated Dell PowerEdge R720 16-bay
 * chassis with 7 installed SAS drives so the UI is always fully functional.
 *
 * Normalized shape:
 *   {
 *     serverId, model, timestamp,
 *     summary: { status, totalBays, installedDrives, healthyDrives, warnings,
 *                failed, raidStatus, raidLevel, diskUsagePercent, source },
 *     drives: [ Drive, ... ]   // one entry per bay (installed + empty)
 *   }
 */

const { exec } = require("child_process");
const os = require("os");

const TOTAL_BAYS = 16; // Dell R720 3.5"/2.5" front backplane

// ---------------------------------------------------------------------------
// Guarded shell helper — never rejects, resolves "" on any failure/timeout.
// ---------------------------------------------------------------------------
function run(cmd, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      exec(cmd, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve("");
        resolve(String(stdout || ""));
      });
    } catch {
      resolve("");
    }
  });
}

// ---------------------------------------------------------------------------
// Health-rule engine — maps raw drive telemetry to a status + score.
// Rules (per spec):
//   SMART failed / RAID offline / missing / temp >= 60C -> failed (red)
//   temp >= 55C / pending sectors / growing errors       -> warning (orange)
//   rebuilding                                            -> rebuilding (yellow)
//   active I/O                                            -> active (blue)
//   otherwise                                             -> healthy (green)
// ---------------------------------------------------------------------------
function evaluateDrive(d) {
  const reasons = [];
  let status = "healthy";
  let score = 100;

  if (d.rebuildPercent != null && d.rebuildPercent < 100) {
    status = "rebuilding";
    score = Math.min(score, 60);
    reasons.push(`Rebuilding (${d.rebuildPercent}%)`);
  }

  // Warning-level signals
  if (d.pendingSectors > 0) {
    reasons.push(`${d.pendingSectors} pending sector(s)`);
    score -= 15;
    if (status === "healthy") status = "warning";
  }
  if (d.reallocatedSectors > 0) {
    reasons.push(`${d.reallocatedSectors} reallocated sector(s)`);
    score -= 10;
    if (status === "healthy") status = "warning";
  }
  if (d.temperatureC >= 55 && d.temperatureC < 60) {
    reasons.push(`High temperature ${d.temperatureC}°C`);
    score -= 15;
    if (status === "healthy") status = "warning";
  }

  // Failure-level signals (override everything)
  if (d.temperatureC >= 60) {
    status = "failed";
    score = Math.min(score, 20);
    reasons.push(`Critical temperature ${d.temperatureC}°C`);
  }
  if (d.smartStatus === "FAILED" || d.smartStatus === "FAILING") {
    status = "failed";
    score = Math.min(score, 10);
    reasons.push("SMART self-assessment failed");
  }
  if (d.raidState === "OFFLINE" || d.raidState === "FAILED") {
    status = "failed";
    score = Math.min(score, 10);
    reasons.push("RAID member offline");
  }
  if (d.missing) {
    status = "failed";
    score = 0;
    reasons.push("Drive missing / not detected");
  }

  // Active I/O is a live (not health) state — only surface it on otherwise
  // healthy drives so it never masks a warning.
  if (status === "healthy" && (d.readMBps > 40 || d.writeMBps > 25)) {
    status = "active";
  }

  return { status, healthScore: Math.max(0, Math.round(score)), healthReasons: reasons };
}

// ---------------------------------------------------------------------------
// Deterministic PRNG so a given serverId yields a stable chassis inventory
// (serials, models, power-on hours) while live metrics jitter per poll.
// ---------------------------------------------------------------------------
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Simulated Dell R720 — 7 installed SAS drives, RAID-6, one live-active drive.
// Live-ish values (temperature, throughput) jitter each call; identity fields
// stay stable for the given serverId.
// ---------------------------------------------------------------------------
function buildSimulated(serverId) {
  const rnd = seededRandom(String(serverId || "host"));
  const now = Date.now();
  // Slow sine wave keeps successive polls smoothly varying rather than random.
  const wave = (offset) => (Math.sin(now / 9000 + offset) + 1) / 2;

  const MODELS = [
    { model: "Dell EMC 1.2TB 10K SAS", capacityGB: 1200, rpm: 10000 },
    { model: "Seagate Exos 15E900 900GB SAS", capacityGB: 900, rpm: 15000 },
    { model: "Toshiba AL15SEB120N 1.2TB SAS", capacityGB: 1200, rpm: 10000 },
    { model: "Dell EMC 600GB 15K SAS", capacityGB: 600, rpm: 15000 },
  ];

  const drives = [];
  for (let bay = 1; bay <= TOTAL_BAYS; bay++) {
    if (bay > 7) {
      // Empty bays 8-16 remain visible.
      drives.push({
        bay,
        installed: false,
        status: "empty",
        model: null,
        serial: null,
        capacityGB: null,
        temperatureC: null,
        powerOnHours: null,
        smartStatus: null,
        raidState: null,
        readMBps: null,
        writeMBps: null,
        utilizationPercent: null,
        healthScore: null,
        healthReasons: [],
        rebuildPercent: null,
      });
      continue;
    }

    const spec = MODELS[(bay - 1) % MODELS.length];
    const serial = `S${(bay * 733 + 10000 + Math.floor(rnd() * 90000)).toString(36).toUpperCase()}${(bay * 97).toString(36).toUpperCase()}`;
    const powerOnHours = 8000 + Math.floor(rnd() * 22000);
    const baseTemp = 33 + Math.floor(rnd() * 6);

    // Bay 3 carries the live I/O load; everything else idles healthy.
    const isActive = bay === 3;
    const readMBps = isActive
      ? Math.round(120 + wave(bay) * 180)
      : Math.round(4 + wave(bay) * 22);
    const writeMBps = isActive
      ? Math.round(60 + wave(bay + 2) * 120)
      : Math.round(2 + wave(bay + 2) * 14);

    const temperatureC = Math.round(baseTemp + wave(bay + 5) * 6 + (isActive ? 4 : 0));
    const utilizationPercent = Math.min(
      99,
      Math.round(30 + (bay * 7) % 40 + wave(bay + 3) * 10)
    );

    const raw = {
      bay,
      installed: true,
      model: spec.model,
      serial,
      capacityGB: spec.capacityGB,
      rpm: spec.rpm,
      temperatureC,
      powerOnHours,
      smartStatus: "PASSED",
      raidState: "ONLINE",
      readMBps,
      writeMBps,
      utilizationPercent,
      pendingSectors: 0,
      reallocatedSectors: 0,
      rebuildPercent: null,
      missing: false,
    };

    const verdict = evaluateDrive(raw);
    drives.push({ ...raw, ...verdict });
  }

  return finalize(serverId, drives, {
    model: "Dell PowerEdge R720",
    raidLevel: "RAID-6",
    source: "simulated",
    diskUsagePercent: 63,
  });
}

// ---------------------------------------------------------------------------
// Assemble the summary from the per-drive list (shared by real + simulated).
// ---------------------------------------------------------------------------
function finalize(serverId, drives, meta) {
  const installed = drives.filter((d) => d.installed);
  const healthy = installed.filter((d) => d.status === "healthy" || d.status === "active");
  const warnings = installed.filter((d) => d.status === "warning");
  const rebuilding = installed.filter((d) => d.status === "rebuilding");
  const failed = installed.filter((d) => d.status === "failed");

  let status = "healthy";
  if (failed.length > 0) status = "failed";
  else if (rebuilding.length > 0) status = "rebuilding";
  else if (warnings.length > 0) status = "warning";

  let raidStatus = "Healthy";
  if (failed.length > 1) raidStatus = "Degraded";
  else if (failed.length === 1) raidStatus = "Degraded";
  else if (rebuilding.length > 0) raidStatus = "Rebuilding";

  return {
    serverId: String(serverId || "host"),
    model: meta.model,
    timestamp: new Date().toISOString(),
    summary: {
      status,
      totalBays: TOTAL_BAYS,
      installedDrives: installed.length,
      healthyDrives: healthy.length + rebuilding.length + warnings.length, // installed & present
      trueHealthyDrives: healthy.length,
      warnings: warnings.length,
      failed: failed.length,
      rebuilding: rebuilding.length,
      raidStatus,
      raidLevel: meta.raidLevel,
      diskUsagePercent: meta.diskUsagePercent,
      source: meta.source,
    },
    drives,
  };
}

// ---------------------------------------------------------------------------
// Real Linux collection. Returns null when nothing usable was gathered so the
// caller can fall back to the simulated chassis.
// ---------------------------------------------------------------------------
async function collectReal(serverId) {
  if (os.platform() !== "linux") return null;

  const lsblkOut = await run("lsblk -dn -o NAME,TYPE,SIZE,MODEL,SERIAL -b");
  if (!lsblkOut.trim()) return null;

  const disks = lsblkOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const name = parts[0];
      const type = parts[1];
      const sizeBytes = Number(parts[2]) || 0;
      const model = parts.slice(3, parts.length - 1).join(" ") || "Unknown";
      const serial = parts[parts.length - 1] || null;
      return { name, type, sizeBytes, model, serial };
    })
    .filter((d) => d.type === "disk" && d.name && !/^loop|^ram/.test(d.name));

  if (disks.length === 0) return null;

  // df for overall filesystem utilization (best-effort).
  let diskUsagePercent = 0;
  const dfOut = await run("df -P / | tail -1");
  const dfMatch = dfOut.match(/(\d+)%/);
  if (dfMatch) diskUsagePercent = Number(dfMatch[1]);

  // iostat snapshot for read/write throughput keyed by device name.
  const io = {};
  const iostatOut = await run("iostat -dk 1 1");
  iostatOut.split("\n").forEach((line) => {
    const m = line.trim().split(/\s+/);
    // Device kB_read/s kB_wrtn/s ... columns vary; guard on numeric.
    if (m.length >= 3 && /^[a-z]/i.test(m[0]) && !isNaN(Number(m[2]))) {
      io[m[0]] = {
        readMBps: Math.round((Number(m[2]) || 0) / 1024),
        writeMBps: Math.round((Number(m[3]) || 0) / 1024),
      };
    }
  });

  const drives = [];
  let bay = 1;
  for (const disk of disks) {
    if (bay > TOTAL_BAYS) break;

    // smartctl per device (health + temperature + power-on hours + sectors).
    const smart = await run(`smartctl -A -H /dev/${disk.name}`);
    const smartStatus = /PASSED/i.test(smart)
      ? "PASSED"
      : /FAILED/i.test(smart)
      ? "FAILED"
      : "UNKNOWN";
    const tempMatch = smart.match(/Temperature[_\s]?Celsius[^\d]*(\d+)/i) || smart.match(/Current Drive Temperature:\s*(\d+)/i);
    const pohMatch = smart.match(/Power_On_Hours[^\d]*(\d+)/i) || smart.match(/number of hours powered up\s*=\s*([\d.]+)/i);
    const pendingMatch = smart.match(/Current_Pending_Sector[^\d]*(\d+)/i);
    const reallocMatch = smart.match(/Reallocated_Sector_Ct[^\d]*(\d+)/i);

    const raw = {
      bay,
      installed: true,
      model: disk.model,
      serial: disk.serial,
      capacityGB: Math.round(disk.sizeBytes / 1024 ** 3),
      temperatureC: tempMatch ? Number(tempMatch[1]) : 35,
      powerOnHours: pohMatch ? Math.round(Number(pohMatch[1])) : null,
      smartStatus,
      raidState: "ONLINE",
      readMBps: io[disk.name]?.readMBps ?? 0,
      writeMBps: io[disk.name]?.writeMBps ?? 0,
      utilizationPercent: diskUsagePercent,
      pendingSectors: pendingMatch ? Number(pendingMatch[1]) : 0,
      reallocatedSectors: reallocMatch ? Number(reallocMatch[1]) : 0,
      rebuildPercent: null,
      missing: false,
    };

    drives.push({ ...raw, ...evaluateDrive(raw) });
    bay++;
  }

  // Pad remaining bays as empty.
  for (let b = drives.length + 1; b <= TOTAL_BAYS; b++) {
    drives.push({
      bay: b,
      installed: false,
      status: "empty",
      model: null,
      serial: null,
      capacityGB: null,
      temperatureC: null,
      powerOnHours: null,
      smartStatus: null,
      raidState: null,
      readMBps: null,
      writeMBps: null,
      utilizationPercent: null,
      healthScore: null,
      healthReasons: [],
      rebuildPercent: null,
    });
  }

  // RAID controller level (storcli/perccli), best-effort.
  let raidLevel = "RAID";
  const storOut =
    (await run("storcli /c0/vall show 2>/dev/null")) ||
    (await run("perccli /c0/vall show 2>/dev/null"));
  const raidMatch = storOut.match(/RAID[- ]?(\d+)/i);
  if (raidMatch) raidLevel = `RAID-${raidMatch[1]}`;

  return finalize(serverId, drives, {
    model: os.hostname(),
    raidLevel,
    source: "live",
    diskUsagePercent,
  });
}

/**
 * Public entry point. Always resolves to a normalized payload.
 * @param {string} serverId - server identifier ("host" for the local machine).
 */
async function getStorageHealth(serverId) {
  try {
    const real = await collectReal(serverId);
    if (real && real.summary.installedDrives > 0) return real;
  } catch (err) {
    // fall through to simulated
    console.error("Storage telemetry real-collection failed:", err.message);
  }
  return buildSimulated(serverId);
}

module.exports = { getStorageHealth, evaluateDrive, TOTAL_BAYS };
