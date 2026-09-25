const Task = require("../models/Task");
const Employee = require("../models/Employee");

/**
 * AI Suggestions Engine
 * Analyzes a task and returns optimized, data-driven follow-up timers,
 * risk scores, escalation levels, backup assignees, and next actions.
 * 
 * @param {string} taskId - The ID of the task to analyze.
 * @returns {Promise<Object>} The AI recommendations object.
 */
async function generateAISuggestions(taskId) {
  try {
    const task = await Task.findById(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    // 1. Calculate Suggested Follow-Up Interval & Escalation Timing
    let suggestedInterval = 30; // default in minutes
    let recommendedEscalation = 15; // default in minutes

    if (task.priority === "high") {
      suggestedInterval = 15;
      recommendedEscalation = 10;
    } else if (task.priority === "medium") {
      suggestedInterval = 30;
      recommendedEscalation = 20;
    } else if (task.priority === "low") {
      suggestedInterval = 60;
      recommendedEscalation = 30;
    }

    // Override or fine-tune based on category
    if (task.category === "bug") {
      suggestedInterval = Math.min(suggestedInterval, 15);
      recommendedEscalation = Math.min(recommendedEscalation, 10);
    } else if (task.category === "maintenance") {
      suggestedInterval = Math.min(suggestedInterval, 45);
    }

    // 2. Risk Score calculation (0 - 100)
    let riskScore = 15; // baseline

    // Priority contribution
    if (task.priority === "high") riskScore += 25;
    else if (task.priority === "medium") riskScore += 10;

    // Status contribution
    if (task.status === "overdue") {
      riskScore = 95; // high risk!
    } else if (task.status === "pending") {
      riskScore += 15;
    }

    // Assignee workload check
    const primaryAssignee = Array.isArray(task.assignees) && task.assignees.length > 0 ? task.assignees[0] : null;
    let assigneeWorkloadCount = 0;
    if (primaryAssignee) {
      assigneeWorkloadCount = await Task.countDocuments({
        assignees: primaryAssignee,
        status: { $in: ["pending", "in-progress"] }
      });
      // Every active task adds 5% risk due to context switching
      riskScore += Math.min(30, assigneeWorkloadCount * 5);
    }

    // Proximity to Due Date contribution
    if (task.dueDate && task.status !== "completed") {
      const now = new Date();
      const due = new Date(task.dueDate);
      const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursLeft < 0) {
        riskScore = 100; // breached/overdue
      } else if (hoursLeft <= 2) {
        riskScore += 35; // critical time-left
      } else if (hoursLeft <= 8) {
        riskScore += 20; // due today
      } else if (hoursLeft <= 24) {
        riskScore += 10; // due tomorrow
      }
    }

    // Cap risk score between 0 and 100
    riskScore = Math.max(0, Math.min(100, riskScore));

    // 3. Smart Backup Assignee suggestion
    // Scan all employees and select the one with the lowest active task workload who is active
    let suggestedAssignee = "";
    const activeEmployees = await Employee.find({ status: "active" }).lean();
    if (activeEmployees.length > 0) {
      const workloadStats = await Promise.all(
        activeEmployees.map(async (emp) => {
          const name = emp.name;
          // Avoid suggesting the current assignee if they are already overloaded
          if (task.assignees.includes(name)) {
            return { name, count: Infinity };
          }
          const count = await Task.countDocuments({
            assignees: name,
            status: { $in: ["pending", "in-progress"] }
          });
          return { name, count };
        })
      );

      // Sort by workload count ascending
      workloadStats.sort((a, b) => a.count - b.count);
      if (workloadStats.length > 0 && workloadStats[0].count !== Infinity) {
        suggestedAssignee = workloadStats[0].name;
      } else {
        // Fallback: choose the first active employee that is not currently assigned
        const nonAssigned = activeEmployees.find(e => !task.assignees.includes(e.name));
        suggestedAssignee = nonAssigned ? nonAssigned.name : (activeEmployees[0]?.name || "");
      }
    }

    // 4. Recommended Next Action Checklist
    let recommendedNextAction = "Initial review and status update.";
    const titleLower = task.title.toLowerCase();
    const descLower = task.description.toLowerCase();

    if (task.category === "bug" || titleLower.includes("fix") || titleLower.includes("error") || titleLower.includes("bug")) {
      recommendedNextAction = "Inspect local exception logs, trace network requests in Chrome DevTools, and verify the backend API response payload.";
    } else if (task.category === "maintenance" || titleLower.includes("server") || titleLower.includes("db") || titleLower.includes("migration")) {
      recommendedNextAction = "Verify system resource usages (CPU, Memory), validate database index usage profiles, and trigger a test connection dry-run.";
    } else if (titleLower.includes("design") || titleLower.includes("ui") || titleLower.includes("css") || descLower.includes("screen")) {
      recommendedNextAction = "Validate component responsiveness, match color contrast with the Figma layout token values, and verify micro-animations behavior.";
    } else if (titleLower.includes("meeting") || titleLower.includes("call") || titleLower.includes("discuss")) {
      recommendedNextAction = "Draft agenda bullet points, prepare meeting slideshow documents, and share join links directly to attendees.";
    }

    return {
      suggestedInterval,
      riskScore,
      recommendedEscalation,
      suggestedAssignee,
      recommendedNextAction
    };
  } catch (err) {
    console.error("[AI Engine] Failed to generate recommendations:", err.message);
    return {
      suggestedInterval: 30,
      riskScore: 20,
      recommendedEscalation: 15,
      suggestedAssignee: "",
      recommendedNextAction: "Perform initial verification."
    };
  }
}

module.exports = { generateAISuggestions };
