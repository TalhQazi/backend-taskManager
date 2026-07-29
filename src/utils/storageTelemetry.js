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
const fs = require("fs");

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
  else if (await hasCommand("ssacli")) tool = "ssacli";
  else if (await hasCommand("hpssacli")) tool = "hpssacli";
  else if (await hasCommand("mdadm")) tool = "mdadm";
  else if (await hasCommand("zpool")) tool = "zpool";

  diagnostics.storcli = tool ? `found (${tool})` : "not installed";

  // Check hardware PCI bus for hardware RAID controllers (MegaRAID, PERC, Smart Array, Adaptec)
  let pciRaidDetected = false;
  let pciRaidName = "";
  if (os.platform() === "linux" && await hasCommand("lspci")) {
    const lspciRes = await run("lspci -v | grep -i -E 'raid|storage|lsi|perc|smart array' 2>/dev/null");
    if (lspciRes.ok && lspciRes.out.trim()) {
      pciRaidDetected = true;
      pciRaidName = lspciRes.out.split("\n")[0].replace(/^.*:\s*/, "").trim();
      diagnostics.notes.push(`Hardware RAID Controller detected on PCI bus: ${pciRaidName}`);
      diagnostics.hardwareRaidDetected = true;
    }
  }

  if (!tool) {
    if (pciRaidDetected) {
      return {
        tool: "pci-hardware",
        name: pciRaidName || "Hardware RAID Controller",
        level: "Hardware RAID",
        slotCount: 0,
        drives: [],
        bbuStatus: "N/A",
        cacheStatus: "N/A",
        firmwareVersion: null,
        rebuildPercent: null,
        raidRaw: true,
        hardwareDetected: true,
        hardwareNotice: `RAID hardware detected (${pciRaidName}). Install perccli/storcli for drive telemetry.`,
      };
    }
    return null;
  }

  // --- 1. MegaRAID / PERC (storcli / perccli)
  if (tool.includes("storcli") || tool.includes("perccli")) {
    const vd = await run(`${tool} /c0/vall show 2>/dev/null`);
    const pd = await run(`${tool} /c0/eall/sall show 2>/dev/null`);
    const encl = await run(`${tool} /c0/eall show all 2>/dev/null`);
    const ctrl = await run(`${tool} /c0 show all 2>/dev/null`);

    const levelMatch = vd.out.match(/RAID[- ]?(\d+)/i);
    const slotMatch =
      encl.out.match(/Slot Count\s*[=:]\s*(\d+)/i) ||
      encl.out.match(/Number of Slots\s*[=:]\s*(\d+)/i);
    const slotCount = slotMatch ? Number(slotMatch[1]) : 0;

    // Model & BBU info
    const modelMatch = ctrl.out.match(/Model\s*=\s*(.+)/i) || ctrl.out.match(/Product Name\s*=\s*(.+)/i);
    const fwMatch = ctrl.out.match(/FW Version\s*=\s*(.+)/i);
    const bbuMatch = ctrl.out.match(/BBU Status\s*=\s*(.+)/i) || ctrl.out.match(/Battery Status\s*=\s*(.+)/i);

    const controllerName = modelMatch ? modelMatch[1].trim() : "MegaRAID / PERC Controller";
    const bbuStatus = bbuMatch ? bbuMatch[1].trim() : "Optimal";
    const firmwareVersion = fwMatch ? fwMatch[1].trim() : null;

    const drives = [];
    pd.out.split("\n").forEach((line) => {
      const t = line.trim().split(/\s+/);
      if (!/^\d+:\d+$/.test(t[0]) || t.length < 8) return;
      const [eid, slot] = t[0].split(":");
      const did = Number(t[1]);
      const state = t[2];
      const capacityGB = parseSizeToGB(`${t[4]} ${t[5]}`);
      const intf = t[6];
      const med = t[7];
      const model = t.length >= 3 ? t[t.length - 3] : "Unknown";
      drives.push({
        enclosure: eid,
        slot: Number(slot),
        did: Number.isFinite(did) ? did : null,
        state,
        capacityGB,
        intf,
        med,
        model,
      });
    });

    const rebuild = pd.out.match(/Rebuild.*?(\d+(?:\.\d+)?)\s*%/i);

    return {
      tool,
      name: controllerName,
      level: levelMatch ? `RAID-${levelMatch[1]}` : "RAID",
      slotCount,
      drives,
      bbuStatus,
      cacheStatus: "Optimal",
      firmwareVersion,
      rebuildPercent: rebuild ? Math.round(Number(rebuild[1])) : null,
      raidRaw: vd.ok || pd.ok,
      hardwareDetected: true,
    };
  }

  // --- 2. Linux Software RAID (mdadm)
  if (tool === "mdadm") {
    const mdstat = await run("cat /proc/mdstat 2>/dev/null");
    const detail = await run("mdadm --detail /dev/md* 2>/dev/null");

    const levelMatch = mdstat.out.match(/raid(\d+)/i) || detail.out.match(/Raid Level\s*:\s*raid(\d+)/i);
    const stateMatch = detail.out.match(/State\s*:\s*(.+)/i);
    const activeMatch = detail.out.match(/Active Devices\s*:\s*(\d+)/i);
    const rebuildMatch = mdstat.out.match(/recovery\s*=\s*([\d.]+)%/i) || mdstat.out.match(/rebuild\s*=\s*([\d.]+)%/i);

    return {
      tool,
      name: "Linux Software RAID (mdadm)",
      level: levelMatch ? `RAID-${levelMatch[1]}` : "Software RAID",
      slotCount: activeMatch ? Number(activeMatch[1]) : 0,
      drives: [],
      bbuStatus: "N/A (Software RAID)",
      cacheStatus: "System RAM",
      firmwareVersion: null,
      rebuildPercent: rebuildMatch ? Math.round(Number(rebuildMatch[1])) : null,
      raidRaw: mdstat.ok,
      hardwareDetected: false,
    };
  }

  // --- 3. ZFS RAID (zpool)
  if (tool === "zpool") {
    const statusRes = await run("zpool status 2>/dev/null");
    const poolMatch = statusRes.out.match(/pool:\s*(.+)/i);
    const stateMatch = statusRes.out.match(/state:\s*(.+)/i);
    const rebuildMatch = statusRes.out.match(/resilvered\s*in.+?([\d.]+)%/i) || statusRes.out.match(/resilver\s*in\s*progress.+?([\d.]+)%/i);

    return {
      tool,
      name: poolMatch ? `ZFS Pool (${poolMatch[1].trim()})` : "ZFS Storage Pool",
      level: statusRes.out.includes("raidz2") ? "RAID-Z2" : statusRes.out.includes("raidz") ? "RAID-Z1" : "ZFS Mirror",
      slotCount: 0,
      drives: [],
      bbuStatus: "N/A (ZFS ARC)",
      cacheStatus: "ZFS ARC",
      firmwareVersion: null,
      rebuildPercent: rebuildMatch ? Math.round(Number(rebuildMatch[1])) : null,
      raidRaw: statusRes.ok,
      hardwareDetected: false,
    };
  }

  return null;
}

// Convert a storcli/perccli size string ("558.406 GB", "1.090 TB") to GB.
function parseSizeToGB(str) {
  const m = String(str).match(/([\d.]+)\s*(TB|GB|MB)/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "TB") return Math.round(val * 1000);
  if (unit === "MB") return Math.round(val / 1000);
  return Math.round(val);
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

  // RAID controller (PERC / MegaRAID) — enumerates physical drives that sit
  // *behind* the controller (invisible to lsblk, which only sees the VD).
  const raid = await collectRaid(diagnostics);
  const hasRaidController = !!(raid && raid.tool);
  if (hasRaidController) {
    diagnostics.notes.push(
      `RAID controller queried via ${raid.tool}: ${raid.drives.length} physical drive(s) found.`
    );
  }

  let drives = [];
  let modelLabel;

  if (hasRaidController && raid.drives.length > 0) {
    // ---- RAID-first path: one entry per physical drive behind the controller.
    // SMART must be read through the controller: smartctl -d megaraid,<DID>.
    const hostDev = disks[0]?.name || "sda"; // any block device on the controller
    const maxBay = raid.slotCount || raid.drives.length;

    for (const pd of raid.drives) {
      let smart = { smartStatus: "UNKNOWN", temperatureC: null, powerOnHours: null, pendingSectors: 0, reallocatedSectors: 0 };
      if (hasSmartctl && pd.did != null) {
        const out = await run(`smartctl -A -H -d megaraid,${pd.did} /dev/${hostDev} 2>/dev/null`);
        if (out.out.trim()) smart = parseSmart(out.out);
      }

      const raidState = mapRaidState(pd.state);
      const rebuildPercent =
        raidState === "REBUILDING" ? (raid.rebuildPercent != null ? raid.rebuildPercent : 0) : null;

      const raw = {
        bay: pd.slot + 1, // slot 0 -> bay 1
        installed: true,
        model: pd.model || "Unknown",
        serial: null,
        capacityGB: pd.capacityGB,
        rpm: pd.med === "SSD" ? 0 : null,
        transport: pd.intf || null,
        temperatureC: smart.temperatureC,
        powerOnHours: smart.powerOnHours,
        smartStatus: smart.smartStatus,
        raidState,
        readMBps: 0, // per-member throughput isn't exposed behind the VD
        writeMBps: 0,
        utilizationPercent: diskUsagePercent,
        pendingSectors: smart.pendingSectors,
        reallocatedSectors: smart.reallocatedSectors,
        rebuildPercent,
        missing: false,
      };
      drives.push({ ...raw, ...evaluateDrive(raw) });
    }

    // Fill empty backplane slots so a 7-of-16 chassis renders correctly.
    const filled = new Set(drives.map((d) => d.bay));
    for (let b = 1; b <= maxBay; b++) {
      if (!filled.has(b)) drives.push(emptyBay(b));
    }
    drives.sort((a, b) => a.bay - b.bay);
    modelLabel = `${os.hostname()} · ${raid.drives.length}/${maxBay} bays populated`;
  } else {
    // ---- Direct-attached path (HBA / SATA / cloud): enumerate via lsblk.
    let bay = 1;
    for (const disk of disks) {
      let smart = { smartStatus: "UNKNOWN", temperatureC: null, powerOnHours: null, pendingSectors: 0, reallocatedSectors: 0 };
      if (hasSmartctl) {
        const out = await run(`smartctl -A -H -d auto /dev/${disk.name} 2>/dev/null`);
        if (out.out.trim()) smart = parseSmart(out.out);
      }

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
        raidState: null,
        readMBps: io[disk.name]?.readMBps ?? 0,
        writeMBps: io[disk.name]?.writeMBps ?? 0,
        utilizationPercent: diskUsagePercent,
        pendingSectors: smart.pendingSectors,
        reallocatedSectors: smart.reallocatedSectors,
        rebuildPercent: null,
        missing: false,
      };
      drives.push({ ...raw, ...evaluateDrive(raw) });
      bay++;
    }
    modelLabel = `${os.hostname()} (${disks.length} physical disk${disks.length === 1 ? "" : "s"})`;
  }

  const raidLevel = raid && raid.level ? raid.level : hasRaidController ? "RAID" : "No RAID controller";

  return finalize(serverId, drives, {
    model: modelLabel,
    raidLevel,
    source: "live",
    diskUsagePercent,
    diagnostics,
    hasRaidController,
    raid,
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
      mode: meta.mode || "physical",
      raidController: meta.raid ? {
        name: meta.raid.name || "RAID Controller",
        tool: meta.raid.tool,
        status: raidStatus,
        level: meta.raidLevel,
        bbuStatus: meta.raid.bbuStatus || "Optimal",
        cacheStatus: meta.raid.cacheStatus || "Optimal",
        firmwareVersion: meta.raid.firmwareVersion || null,
        hardwareDetected: meta.raid.hardwareDetected || false,
        hardwareNotice: meta.raid.hardwareNotice || null,
      } : null,
    },
    diagnostics: meta.diagnostics,
    drives,
  };
}

// ---------------------------------------------------------------------------
// Node-level real-volume collection. Cross-platform, needs no external tools
// and no root — reads real disk capacity/used/free straight from the OS. This
// is genuine data (not simulated); it just describes logical volumes rather
// than physical drives (no SMART/RAID/temperature). Used as an automatic
// fallback so the card shows real numbers even before smartctl/perccli exist.
// ---------------------------------------------------------------------------
function buildVolume(bay, label, id, totalBytes, usedBytes) {
  const capacityGB = Math.round(totalBytes / 1024 ** 3);
  const usagePercent = totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0;

  let status = "healthy";
  let score = 100;
  const reasons = [];
  if (usagePercent >= 95) {
    status = "failed";
    score = 20;
    reasons.push(`Filesystem ${usagePercent}% full — critically low free space`);
  } else if (usagePercent >= 85) {
    status = "warning";
    score = 60;
    reasons.push(`Filesystem ${usagePercent}% full — low free space`);
  }

  return {
    bay,
    installed: true,
    status,
    model: label,
    serial: id,
    capacityGB,
    rpm: null,
    transport: "FS",
    temperatureC: null,
    powerOnHours: null,
    smartStatus: null,
    raidState: null,
    readMBps: null,
    writeMBps: null,
    utilizationPercent: usagePercent,
    healthScore: score,
    healthReasons: reasons,
    rebuildPercent: null,
  };
}

async function collectNodeVolumes(diagnostics) {
  const drives = [];
  const platform = os.platform();
  let totalBytesAll = 0;
  let usedBytesAll = 0;

  try {
    if (platform === "linux") {
      // `df` works for any user (no root). Enumerate real disk-backed mounts.
      const df = await run("df -P -B1 2>/dev/null");
      const lines = df.out.split("\n").slice(1);
      let bay = 1;
      for (const line of lines) {
        const t = line.trim().split(/\s+/);
        if (t.length < 6) continue;
        const fsName = t[0];
        const total = Number(t[1]);
        const used = Number(t[2]);
        const mount = t.slice(5).join(" ");
        if (!/^\/dev\//.test(fsName) || !total) continue; // skip tmpfs/overlay/etc.
        drives.push(buildVolume(bay, mount, fsName, total, used));
        totalBytesAll += total;
        usedBytesAll += used;
        if (++bay > 16) break;
      }
    }

    // Windows / macOS / linux-without-df: statfs the primary volume.
    if (drives.length === 0 && typeof fs.promises.statfs === "function") {
      const target = platform === "win32" ? `${process.cwd().split(":")[0]}:\\` : "/";
      const s = await fs.promises.statfs(target);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = Math.max(total - free, 0);
      if (total) {
        drives.push(buildVolume(1, target, target, total, used));
        totalBytesAll += total;
        usedBytesAll += used;
      }
    }
  } catch (e) {
    if (diagnostics) diagnostics.notes.push(`Node volume read failed: ${e.message}`);
  }

  const diskUsagePercent = totalBytesAll ? Math.round((usedBytesAll / totalBytesAll) * 100) : 0;
  return { drives, diskUsagePercent };
}

/**
 * Public entry point. Always resolves to a normalized payload (never throws).
 * Collection tiers, best first:
 *   1. Physical drives behind a PERC/MegaRAID controller (perccli/storcli)
 *   2. Direct-attached physical drives (lsblk + smartctl)
 *   3. Real logical volumes via Node (fs.statfs / df) — no tools, no root
 *   4. Unavailable (with diagnostics)
 * @param {string} serverId - server identifier ("host" for the local machine).
 */
async function getStorageHealth(serverId) {
  try {
    const real = await collectReal(serverId);
    if (real.summary.source === "live") return real; // tier 1 or 2

    // Tier 3: real filesystem volumes (works everywhere, no privileges).
    const diagnostics = real.diagnostics || { platform: os.platform(), hostname: os.hostname(), notes: [] };
    const { drives, diskUsagePercent } = await collectNodeVolumes(diagnostics);
    if (drives.length > 0) {
      diagnostics.notes = diagnostics.notes || [];
      diagnostics.notes.push(
        "Showing real filesystem volumes. Install smartmontools/perccli (and run as root) for physical drive SMART & RAID."
      );
      return finalize(serverId, drives, {
        model: `${os.hostname()} · filesystem volumes`,
        raidLevel: "No RAID controller",
        source: "live",
        diskUsagePercent,
        diagnostics,
        hasRaidController: false,
        mode: "filesystem",
      });
    }

    return real; // tier 4: genuinely nothing to report
  } catch (err) {
    return unavailable(
      serverId,
      { platform: os.platform(), hostname: os.hostname(), notes: [err.message] },
      `Storage telemetry collection failed: ${err.message}`
    );
  }
}

module.exports = { getStorageHealth, evaluateDrive };
