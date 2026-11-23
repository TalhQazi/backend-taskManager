const Task = require("../models/Task");
const Project = require("../models/Project");
const { cacheDel } = require("../lib/cache");

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

    // Flush Redis cache for tasks & projects
    try {
      await cacheDel("tasks:*");
      await cacheDel("tasks:list:*");
      await cacheDel("projects:*");
      await cacheDel("projects:list:*");
    } catch (e) {}
  } catch (err) {
    console.error("[EmployeeCleanup] error:", err.message);
  }

  return { tasksUpdated, projectsUpdated };
}

module.exports = { cleanupEmployeeAssignments };
