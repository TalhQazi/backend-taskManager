const Task = require("../models/Task");
const Project = require("../models/Project");
const Employee = require("../models/Employee");
const User = require("../models/User");
const { cacheDel } = require("../lib/cache");

let cachedActiveTokens = null;
let cachedActiveTokensAt = 0;
const ACTIVE_TOKEN_TTL_MS = 30000;

function invalidateActiveMemberCache() {
  cachedActiveTokens = null;
  cachedActiveTokensAt = 0;
}

/**
 * Returns a Set of lowercased tokens (name, email, username, id) belonging to
 * currently active Employees & Users. Fails open (empty Set) on query errors.
 */
async function getActiveMemberTokenSet() {
  const now = Date.now();
  if (cachedActiveTokens && now - cachedActiveTokensAt < ACTIVE_TOKEN_TTL_MS) {
    return cachedActiveTokens;
  }

  try {
    const [employees, users] = await Promise.all([
      Employee.find({ status: { $ne: "inactive" }, userStatus: { $ne: "inactive" } })
        .select("_id name email username")
        .lean(),
      User.find({ status: { $ne: "inactive" } })
        .select("_id name email username")
        .lean(),
    ]);

    const tokens = new Set();
    for (const person of [...employees, ...users]) {
      for (const field of [person._id, person.name, person.email, person.username]) {
        const val = String(field || "").trim().toLowerCase();
        if (val) tokens.add(val);
      }
    }

    cachedActiveTokens = tokens;
    cachedActiveTokensAt = now;
    return tokens;
  } catch (err) {
    console.error("[EmployeeCleanup] Failed to build active member set:", err.message);
    return new Set();
  }
}

/**
 * Filters departed/deleted assignees out of formatted Task or Project items
 * and opportunistically cleans stale entries from MongoDB in the background.
 */
function stripInactiveAssigneesForDocs(docs, activeSet, Model = null) {
  if (!Array.isArray(docs) || docs.length === 0) return docs;
  if (!activeSet || activeSet.size === 0) return docs;

  const isMemberActive = (val) => {
    const key = String(val || "").trim().toLowerCase();
    return key ? activeSet.has(key) : false;
  };

  const pendingUpdates = [];

  const cleaned = docs.map((doc) => {
    if (!doc || typeof doc !== "object") return doc;
    let changed = false;
    const next = { ...doc };

    if (Array.isArray(doc.assignees)) {
      const filteredAssignees = [];
      const seen = new Set();
      for (const a of doc.assignees) {
        const trimmed = String(a || "").trim();
        const lower = trimmed.toLowerCase();
        if (!trimmed || !activeSet.has(lower)) {
          changed = true;
          continue;
        }
        if (seen.has(lower)) {
          changed = true;
          continue;
        }
        seen.add(lower);
        filteredAssignees.push(trimmed);
      }
      next.assignees = filteredAssignees;
    }

    if (typeof doc.teamLead === "string" && doc.teamLead.trim() && !isMemberActive(doc.teamLead)) {
      next.teamLead = "";
      changed = true;
    }

    if (changed && Model && (doc._id || doc.id)) {
      const docId = doc._id || doc.id;
      const updateSet = { assignees: next.assignees || [] };
      if ("teamLead" in doc) updateSet.teamLead = next.teamLead || "";
      pendingUpdates.push({ updateOne: { filter: { _id: docId }, update: { $set: updateSet } } });
    }

    return next;
  });

  if (pendingUpdates.length > 0 && Model) {
    void Model.bulkWrite(pendingUpdates, { ordered: false }).catch((err) => {
      console.error("[EmployeeCleanup] Background assignee heal failed:", err.message);
    });
  }

  return cleaned;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Robustly removes an employee or user from all tasks, projects, and clears cache.
 * Matches by name, username, email, ID (case-insensitive regex and exact).
 */
async function cleanupEmployeeAssignments(person) {
  if (!person) return { tasksUpdated: 0, projectsUpdated: 0 };

  const idStr = String(person._id || person.id || "").trim();
  const name = String(person.name || "").trim();
  const email = String(person.email || "").trim();
  const username = String(person.username || "").trim();

  // Generate tokens to remove
  const rawTokens = [idStr, name, email, username].filter(Boolean);
  if (rawTokens.length === 0) return { tasksUpdated: 0, projectsUpdated: 0 };

  const regexes = rawTokens.map((t) => new RegExp(`^${escapeRegex(t)}$`, "i"));

  let tasksUpdated = 0;
  let projectsUpdated = 0;

  try {
    if (Task) {
      const filter = {
        $or: [
          { assignees: { $in: regexes } },
          { assignee: { $in: regexes } },
          { employee: { $in: regexes } },
          { teamLead: { $in: regexes } },
        ],
      };

      const tasks = await Task.find(filter);
      for (const t of tasks) {
        let changed = false;
        if (Array.isArray(t.assignees) && t.assignees.length > 0) {
          const newAssignees = t.assignees.filter((a) => {
            const trimmed = String(a || "").trim().toLowerCase();
            return !rawTokens.some((tok) => tok.toLowerCase() === trimmed);
          });
          if (newAssignees.length !== t.assignees.length) {
            t.assignees = newAssignees;
            changed = true;
          }
        }

        if (t.assignee && rawTokens.some((tok) => tok.toLowerCase() === String(t.assignee).trim().toLowerCase())) {
          t.assignee = "";
          changed = true;
        }

        if (t.employee && rawTokens.some((tok) => tok.toLowerCase() === String(t.employee).trim().toLowerCase())) {
          t.employee = "";
          changed = true;
        }

        if (t.teamLead && rawTokens.some((tok) => tok.toLowerCase() === String(t.teamLead).trim().toLowerCase())) {
          t.teamLead = "";
          changed = true;
        }

        if (changed) {
          await t.save();
          tasksUpdated++;
        }
      }
    }

    if (Project) {
      const projectFilter = {
        $or: [
          { assignees: { $in: regexes } },
          { teamLead: { $in: regexes } },
          { lead: { $in: regexes } },
        ],
      };

      const projects = await Project.find(projectFilter);
      for (const p of projects) {
        let changed = false;
        if (Array.isArray(p.assignees) && p.assignees.length > 0) {
          const newAssignees = p.assignees.filter((a) => {
            const trimmed = String(a || "").trim().toLowerCase();
            return !rawTokens.some((tok) => tok.toLowerCase() === trimmed);
          });
          if (newAssignees.length !== p.assignees.length) {
            p.assignees = newAssignees;
            changed = true;
          }
        }

        if (p.teamLead && rawTokens.some((tok) => tok.toLowerCase() === String(p.teamLead).trim().toLowerCase())) {
          p.teamLead = "";
          changed = true;
        }

        if (p.lead && rawTokens.some((tok) => tok.toLowerCase() === String(p.lead).trim().toLowerCase())) {
          p.lead = "";
          changed = true;
        }

        if (changed) {
          await p.save();
          projectsUpdated++;
          try {
            await cacheDel(`project:${p._id}`);
          } catch (e) {}
        }
      }
    }

    // Flush Redis cache for tasks & projects and active-member lookup cache
    invalidateActiveMemberCache();
    try {
      await cacheDel("tasks:*");
      await cacheDel("tasks:list:*");
      await cacheDel("projects:*");
      await cacheDel("projects:list:*");
      await cacheDel("project:*");
    } catch (e) {}
  } catch (err) {
    console.error("[EmployeeCleanup] error:", err.message);
  }

  return { tasksUpdated, projectsUpdated };
}

module.exports = {
  cleanupEmployeeAssignments,
  invalidateActiveMemberCache,
  getActiveMemberTokenSet,
  stripInactiveAssigneesForDocs,
};
