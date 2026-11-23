const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { connectDb } = require("../src/lib/db");
const Employee = require("../src/models/Employee");
const Archive = require("../src/models/Archive");
const Task = require("../src/models/Task");
const Project = require("../src/models/Project");

async function run() {
  try {
    await connectDb();
    console.log("Connected to database.");

    // Get active employee names and emails
    const activeEmployees = await Employee.find({ status: { $ne: "inactive" } }).lean();
    const activeSet = new Set();
    activeEmployees.forEach(e => {
      if (e.name) activeSet.add(e.name.toLowerCase().trim());
      if (e.email) activeSet.add(e.email.toLowerCase().trim());
    });

    // Get inactive employees
    const inactiveEmployees = await Employee.find({ status: "inactive" }).lean();
    const inactiveTargets = new Set();
    inactiveEmployees.forEach(e => {
      if (e.name) inactiveTargets.add(e.name.toLowerCase().trim());
      if (e.email) inactiveTargets.add(e.email.toLowerCase().trim());
    });

    // Get archived employees
    const archived = await Archive.find({ itemType: { $in: ["employee", "user"] } }).lean();
    archived.forEach(a => {
      const data = a.itemData || a.data || {};
      if (data.name) inactiveTargets.add(data.name.toLowerCase().trim());
      if (data.email) inactiveTargets.add(data.email.toLowerCase().trim());
    });

    // Collect all assignees from Tasks and Projects to see if any are not active
    const tasks = await Task.find({}).lean();
    tasks.forEach(t => {
      const list = Array.isArray(t.assignees) ? t.assignees : [];
      list.forEach(name => {
        const clean = String(name || "").toLowerCase().trim();
        if (clean && !activeSet.has(clean)) {
          inactiveTargets.add(clean);
        }
      });
      if (t.assignee) {
        const clean = String(t.assignee).toLowerCase().trim();
        if (clean && !activeSet.has(clean)) {
          inactiveTargets.add(clean);
        }
      }
      if (t.employee) {
        const clean = String(t.employee).toLowerCase().trim();
        if (clean && !activeSet.has(clean)) {
          inactiveTargets.add(clean);
        }
      }
    });

    const projects = await Project.find({}).lean();
    projects.forEach(p => {
      const list = Array.isArray(p.assignees) ? p.assignees : [];
      list.forEach(name => {
        const clean = String(name || "").toLowerCase().trim();
        if (clean && !activeSet.has(clean)) {
          inactiveTargets.add(clean);
        }
      });
      if (p.teamLead) {
        const clean = String(p.teamLead).toLowerCase().trim();
        if (clean && !activeSet.has(clean)) {
          inactiveTargets.add(clean);
        }
      }
    });

    const targetList = Array.from(inactiveTargets).filter(Boolean);
    console.log(`Found ${targetList.length} inactive/archived target identifiers to clean up:`, targetList);

    if (targetList.length === 0) {
      console.log("No inactive employees to clean up.");
      mongoose.connection.close();
      return;
    }

    // Iterate over targets to clean tasks and projects
    let pulledTasks = 0;
    let clearedAssignees = 0;
    let clearedEmployees = 0;
    let pulledProjects = 0;
    let clearedLeads = 0;

    for (const target of targetList) {
      const regex = new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

      const tPull = await Task.updateMany(
        { assignees: regex },
        { $pull: { assignees: regex } }
      );
      pulledTasks += tPull.modifiedCount;

      const tAssignee = await Task.updateMany(
        { assignee: regex },
        { $set: { assignee: "" } }
      );
      clearedAssignees += tAssignee.modifiedCount;

      const tEmp = await Task.updateMany(
        { employee: regex },
        { $set: { employee: "" } }
      );
      clearedEmployees += tEmp.modifiedCount;

      const pPull = await Project.updateMany(
        { assignees: regex },
        { $pull: { assignees: regex } }
      );
      pulledProjects += pPull.modifiedCount;

      const pLead = await Project.updateMany(
        { teamLead: regex },
        { $set: { teamLead: "" } }
      );
      clearedLeads += pLead.modifiedCount;
    }

    console.log(`Cleanup complete!`);
    console.log(`- Tasks pulled from: ${pulledTasks}`);
    console.log(`- Tasks assignee cleared: ${clearedAssignees}`);
    console.log(`- Tasks employee cleared: ${clearedEmployees}`);
    console.log(`- Projects pulled from: ${pulledProjects}`);
    console.log(`- Projects teamLead cleared: ${clearedLeads}`);

  } catch (err) {
    console.error("Cleanup script failed:", err);
  } finally {
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

run();
