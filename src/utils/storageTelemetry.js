/**
 * Storage telemetry service (real-data only).
 *
 * Collects physical-drive & RAID health for the Linux host the backend runs on
 * and normalizes everything into a single payload for the Super Admin
 * "Storage Health" card. It shells out to the standard tooling:
 *
 *   lsblk           -> physical block-device inventory (model/serial/size/transport)
 *   smartctl        -> SMART health / temperature / power-on hours / sectors
 *   iostat          -> per-device read/write throughput
 *   df              -> filesystem utilization
 *   storcli/perccli -> PERC / MegaRAID controller + physical-disk RAID state
 *
 * There is NO simulated fallback. When real telemetry cannot be gathered
 * (wrong OS, missing binary, insufficient permission, no physical disks) the
 * service returns `source: "unavailable"` together with a `diagnostics` object
 * explaining precisely why, so the UI can show an honest empty state and the
 * operator knows exactly what to install / fix.
 */

const { exec } = require("child_process");
const os = require("os");

// Guarded shell helper — resolves { ok, out, err } and never throws.
function run(cmd, timeout = 6000) {
  return new Promise((resolve) => {
    try {
      exec(cmd, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          out: String(stdout || ""),
          err: String((error && error.message) || stderr || ""),
        });
      });
    } catch (e) {
      resolve({ ok: false, out: "", err: e.message });
    }
  });
}

// Is a CLI available on PATH?
async function hasCommand(bin) {
  const r = await run(`command -v ${bin}`, 2500);
  return r.ok && r.out.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Health-rule engine — maps raw drive telemetry to a status + score.
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
  if (d.temperatureC != null && d.temperatureC >= 55 && d.temperatureC < 60) {
    reasons.push(`High temperature ${d.temperatureC}°C`);
    score -= 15;
    if (status === "healthy") status = "warning";
  }

  if (d.temperatureC != null && d.temperatureC >= 60) {
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

  if (status === "healthy" && ((d.readMBps || 0) > 40 || (d.writeMBps || 0) > 25)) {
    status = "active";
  }

  return { status, healthScore: Math.max(0, Math.round(score)), healthReasons: reasons };
}

// ---------------------------------------------------------------------------
// Parse a single-device `smartctl -A -H` dump (handles both ATA and SAS/SCSI).
// ---------------------------------------------------------------------------
function parseSmart(text) {
  const smartStatus = /SMART overall-health self-assessment test result:\s*PASSED/i.test(text)
    ? "PASSED"
    : /SMART Health Status:\s*OK/i.test(text)
    ? "PASSED"
    : /(FAILED!?|FAILING_NOW)/i.test(text)
    ? "FAILED"
    : "UNKNOWN";

  const tempMatch =
    text.match(/Temperature_Celsius[^\d]*(\d+)/i) ||
    text.match(/Current Drive Temperature:\s*(\d+)/i) ||
    text.match(/Temperature:\s*(\d+)\s*Celsius/i);

  const pohMatch =
    text.match(/Power_On_Hours[^\d]*(\d+)/i) ||
    text.match(/number of hours powered up\s*=\s*([\d.]+)/i) ||
    text.match(/Accumulated power on time, hours:minutes\s*([\d]+)/i);

  const pendingMatch = text.match(/Current_Pending_Sector[^\d]*(\d+)/i);
  const reallocMatch = text.match(/Reallocated_Sector_Ct[^\d]*(\d+)/i);

  return {
    smartStatus,
    temperatureC: tempMatch ? Number(tempMatch[1]) : null,
    powerOnHours: pohMatch ? Math.round(Number(pohMatch[1])) : null,
    pendingSectors: pendingMatch ? Number(pendingMatch[1]) : 0,
    reallocatedSectors: reallocMatch ? Number(reallocMatch[1]) : 0,
  };
}

// ---------------------------------------------------------------------------
// Best-effort RAID state map from storcli/perccli physical-drive listing.
// Returns { level, slotCount, byName: {}, states: [ 'Onln'|'Rbld'|... ] }.
// ---------------------------------------------------------------------------
async function collectRaid(diagnostics) {
  let tool = null;
  if (await hasCommand("storcli")) tool = "storcli";
  else if (await hasCommand("perccli")) tool = "perccli";
  else if (await hasCommand("storcli64")) tool = "storcli64";
  else if (await hasCommand("perccli64")) tool = "perccli64";

  diagnostics.storcli = tool ? `found (${tool})` : "not installed";
  if (!tool) return null;

  const vd = await run(`${tool} /c0/vall show 2>/dev/null`);
  const pd = await run(`${tool} /c0/eall/sall show 2>/dev/null`);

  const levelMatch = vd.out.match(/RAID[- ]?(\d+)/i);
  // Physical drive states appear as e.g. "252:1  ... Onln" / "Rbld" / "Offln".
  const states = [];
  pd.out.split("\n").forEach((line) => {
    const m = line.match(/\b(\d+):(\d+)\b.*?\b(Onln|Rbld|Offln|Failed|UGood|UBad|GHS|DHS|Msng)\b/i);
    if (m) states.push({ enclosure: m[1], slot: Number(m[2]), state: m[3] });
  });

  const rebuild = pd.out.match(/Rebuild.*?(\d+(?:\.\d+)?)\s*%/i);

  return {
    tool,
    level: levelMatch ? `RAID-${levelMatch[1]}` : null,
    states,
    rebuildPercent: rebuild ? Math.round(Number(rebuild[1])) : null,
    raidRaw: vd.ok || pd.ok,
  };
}

function mapRaidState(s) {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v === "onln") return "ONLINE";
  if (v === "rbld") return "REBUILDING";
  if (v === "offln" || v === "failed" || v === "ubad" || v === "msng") return "OFFLINE";
  return "ONLINE";
}

// ---------------------------------------------------------------------------
// Main real collection. Always resolves to a normalized payload with source
// "live" (drives found) or "unavailable" (with diagnostics explaining why).
// ---------------------------------------------------------------------------
async function collectReal(serverId) {
  const diagnostics = {
    platform: os.platform(),
    hostname: os.hostname(),
    lsblk: "unknown",
    smartctl: "unknown",
    iostat: "unknown",
    storcli: "unknown",
    ranAsRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
    notes: [],
  };

  if (os.platform() !== "linux") {
    diagnostics.notes.push(
      `Physical drive telemetry requires a Linux host; backend is running on '${os.platform()}'.`
    );
    return unavailable(serverId, diagnostics, "Physical drive telemetry is only available on Linux hosts.");
  }

  const hasLsblk = await hasCommand("lsblk");
  diagnostics.lsblk = hasLsblk ? "found" : "not installed";
  if (!hasLsblk) {
    diagnostics.notes.push("lsblk not found — install util-linux.");
    return unavailable(serverId, diagnostics, "lsblk is not available on this host.");
  }

  const lsblk = await run("lsblk -dn -b -o NAME,TYPE,SIZE,MODEL,SERIAL,ROTA,TRAN");
  const disks = lsblk.out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // MODEL can contain spaces; split into fixed head/tail around it.
      const parts = line.split(/\s+/);
      const name = parts[0];
      const type = parts[1];
      const sizeBytes = Number(parts[2]) || 0;
      const tran = parts[parts.length - 1];
      const rota = parts[parts.length - 2];
      const serial = parts[parts.length - 3];
      const model = parts.slice(3, parts.length - 3).join(" ") || "Unknown";
      return { name, type, sizeBytes, model, serial: serial === "" ? null : serial, rota, tran };
    })
    .filter((d) => d.type === "disk" && d.name && !/^(loop|ram|zram|dm-|sr)/.test(d.name));

  if (disks.length === 0) {
    diagnostics.notes.push("lsblk returned no physical disks.");
    return unavailable(serverId, diagnostics, "No physical disks were detected on this host.");
  }

  // Filesystem usage (root).
  let diskUsagePercent = 0;
  const df = await run("df -P / 2>/dev/null | tail -1");
  const dfMatch = df.out.match(/(\d+)%/);
  if (dfMatch) diskUsagePercent = Number(dfMatch[1]);

  // iostat throughput snapshot keyed by device.
  const hasIostat = await hasCommand("iostat");
  diagnostics.iostat = hasIostat ? "found" : "not installed";
  const io = {};
  if (hasIostat) {
    const iostat = await run("iostat -dk 1 1");
    iostat.out.split("\n").forEach((line) => {
      const m = line.trim().split(/\s+/);
      if (m.length >= 4 && /^[a-z]/i.test(m[0]) && !isNaN(Number(m[2]))) {
        io[m[0]] = {
          readMBps: Math.round((Number(m[2]) || 0) / 1024),
          writeMBps: Math.round((Number(m[3]) || 0) / 1024),
        };
      }
    });
  }

  // SMART availability.
  const hasSmartctl = await hasCommand("smartctl");
  diagnostics.smartctl = hasSmartctl ? "found" : "not installed";
  if (!hasSmartctl) diagnostics.notes.push("smartctl not found — install smartmontools for SMART/temperature data.");
  else if (!diagnostics.ranAsRoot) diagnostics.notes.push("Backend is not running as root — smartctl may return no data.");

  // RAID controller.
  const raid = await collectRaid(diagnostics);
  if (raid && raid.tool) diagnostics.notes.push(`RAID controller queried via ${raid.tool}.`);

  const drives = [];
  let bay = 1;
  for (const disk of disks) {
    let smart = { smartStatus: "UNKNOWN", temperatureC: null, powerOnHours: null, pendingSectors: 0, reallocatedSectors: 0 };
    if (hasSmartctl) {
      const out = await run(`smartctl -A -H -d auto /dev/${disk.name} 2>/dev/null`);
      if (out.out.trim()) smart = parseSmart(out.out);
    }

    // Match a RAID physical-drive state by slot order (best-effort).
    const raidEntry = raid && raid.states.length >= bay ? raid.states[bay - 1] : null;
    const raidState = raidEntry ? mapRaidState(raidEntry.state) : raid && raid.tool ? "ONLINE" : null;
    const rebuildPercent =
      raidState === "REBUILDING" ? (raid && raid.rebuildPercent != null ? raid.rebuildPercent : 0) : null;

    const raw = {
      bay,
      installed: true,
      model: disk.model,
      serial: disk.serial,
      capacityGB: Math.round(disk.sizeBytes / 1024 ** 3),
      rpm: disk.rota === "1" ? null : 0, // 0 => SSD/flash; null => unknown RPM
      transport: (disk.tran || "").toUpperCase() || null,
      temperatureC: smart.temperatureC,
      powerOnHours: smart.powerOnHours,
      smartStatus: smart.smartStatus,
      raidState,
      readMBps: io[disk.name]?.readMBps ?? 0,
      writeMBps: io[disk.name]?.writeMBps ?? 0,
      utilizationPercent: diskUsagePercent,
      pendingSectors: smart.pendingSectors,
      reallocatedSectors: smart.reallocatedSectors,
      rebuildPercent,
      missing: false,
    };

    drives.push({ ...raw, ...evaluateDrive(raw) });
    bay++;
  }

  // Bay count: if a RAID enclosure reported more slots, pad the rest as empty;
  // otherwise show exactly the physical disks we found (no invented bays).
  const raidSlots = raid && raid.states.length ? raid.states.length : 0;
  const totalBays = Math.max(drives.length, raidSlots);
  for (let b = drives.length + 1; b <= totalBays; b++) {
    drives.push(emptyBay(b));
  }

  const raidLevel = raid && raid.level ? raid.level : raid && raid.tool ? "RAID" : "No RAID controller";

  return finalize(serverId, drives, {
    model: `${os.hostname()} (${disks.length} physical disk${disks.length === 1 ? "" : "s"})`,
    raidLevel,
    source: "live",
    diskUsagePercent,
    diagnostics,
    hasRaidController: !!(raid && raid.tool),
  });
}

function emptyBay(bay) {
  return {
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
  };
}

function unavailable(serverId, diagnostics, message) {
  return {
    serverId: String(serverId || "host"),
    model: os.hostname(),
    timestamp: new Date().toISOString(),
    summary: {
      status: "unavailable",
      totalBays: 0,
      installedDrives: 0,
      healthyDrives: 0,
      trueHealthyDrives: 0,
      warnings: 0,
      failed: 0,
      rebuilding: 0,
      raidStatus: "N/A",
      raidLevel: "N/A",
      diskUsagePercent: 0,
      source: "unavailable",
      message,
    },
    diagnostics,
    drives: [],
  };
}

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

  let raidStatus;
  if (!meta.hasRaidController) raidStatus = "No RAID";
  else if (failed.length > 0) raidStatus = "Degraded";
  else if (rebuilding.length > 0) raidStatus = "Rebuilding";
  else raidStatus = "Healthy";

  return {
    serverId: String(serverId || "host"),
    model: meta.model,
    timestamp: new Date().toISOString(),
    summary: {
      status,
      totalBays: drives.length,
      installedDrives: installed.length,
      healthyDrives: healthy.length + rebuilding.length + warnings.length,
      trueHealthyDrives: healthy.length,
      warnings: warnings.length,
      failed: failed.length,
      rebuilding: rebuilding.length,
      raidStatus,
      raidLevel: meta.raidLevel,
      diskUsagePercent: meta.diskUsagePercent,
      source: meta.source,
    },
    diagnostics: meta.diagnostics,
    drives,
  };
}

/**
 * Public entry point. Always resolves to a normalized payload (never throws).
 * @param {string} serverId - server identifier ("host" for the local machine).
 */
async function getStorageHealth(serverId) {
  try {
    return await collectReal(serverId);
  } catch (err) {
    return unavailable(
      serverId,
      { platform: os.platform(), hostname: os.hostname(), notes: [err.message] },
      `Storage telemetry collection failed: ${err.message}`
    );
  }
}

module.exports = { getStorageHealth, evaluateDrive };
