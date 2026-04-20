const Contributor = require("../models/Contributor");
const Contribution = require("../models/Contribution");
const Task = require("../models/Task");

/**
 * Contribution Tracker Utility
 * Automatically tracks who did what on tasks and projects
 */

class ContributionTracker {
  /**
   * Track a task creation
   */
  async trackTaskCreation(task, user) {
    try {
      // Ensure contributor exists
      await this.ensureContributor(user);

      // Add to task's contributor list
      const contributorEntry = {
        userId: user.userId || user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        addedAt: new Date(),
        contributionType: "creator",
        actions: ["created"],
      };

      task.createdBy = {
        userId: user.userId || user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };

      task.contributors = [contributorEntry];
      task.contributionHistory = [
        {
          userId: user.userId || user.id,
          name: user.name,
          action: "created",
          timestamp: new Date(),
          details: `Task "${task.title}" created`,
        },
      ];

      await task.save();

      // Create contribution record
      await this.createContribution({
        user,
        action: "task_created",
        resourceType: "task",
        resourceId: task._id.toString(),
        resourceName: task.title,
        projectId: task.projectId?.toString(),
        description: `Created task "${task.title}"`,
        impact: "high",
      });

      // Update contributor stats
      await this.updateContributorStats(user.userId || user.id, {
        $inc: { "stats.totalTasksCreated": 1 },
        $set: { "stats.lastContributionAt": new Date() },
      });
    } catch (error) {
      console.error("[ContributionTracker] Error tracking task creation:", error);
    }
  }

  /**
   * Track a task update
   */
  async trackTaskUpdate(task, user, changes, options = {}) {
    try {
      await this.ensureContributor(user);

      const userId = user.userId || user.id;
      const isNewContributor = !task.contributors.some((c) => c.userId === userId);

      if (isNewContributor) {
        // Add new contributor to task
        task.contributors.push({
          userId: userId,
          name: user.name,
          email: user.email,
          role: user.role,
          addedAt: new Date(),
          contributionType: "updater",
          actions: ["updated"],
        });
      } else {
        // Update existing contributor's actions
        const existing = task.contributors.find((c) => c.userId === userId);
        if (existing && !existing.actions.includes("updated")) {
          existing.actions.push("updated");
        }
      }

      // Add to contribution history
      task.contributionHistory.push({
        userId: userId,
        name: user.name,
        action: options.isStatusChange ? "status_changed" : "updated",
        timestamp: new Date(),
        details: options.description || `Updated task "${task.title}"`,
      });

      await task.save();

      // Create contribution record
      await this.createContribution({
        user,
        action: options.isStatusChange ? "task_status_changed" : "task_updated",
        resourceType: "task",
        resourceId: task._id.toString(),
        resourceName: task.title,
        projectId: task.projectId?.toString(),
        description: options.description || `Updated task "${task.title}"`,
        changes: changes || [],
        impact: options.impact || "medium",
      });

      // Update contributor stats
      await this.updateContributorStats(userId, {
        $inc: { "stats.totalTasksUpdated": 1 },
        $set: { "stats.lastContributionAt": new Date() },
      });
    } catch (error) {
      console.error("[ContributionTracker] Error tracking task update:", error);
    }
  }

  /**
   * Track task completion
   */
  async trackTaskCompletion(task, user) {
    try {
      await this.ensureContributor(user);

      const userId = user.userId || user.id;

      // Add completion to contribution history
      task.contributionHistory.push({
        userId: userId,
        name: user.name,
        action: "completed",
        timestamp: new Date(),
        details: `Completed task "${task.title}"`,
      });

      // Update contributor's actions in task - add if not exists
      let contributor = task.contributors.find((c) => c.userId === userId);
      if (contributor) {
        if (!contributor.actions.includes("completed")) {
          contributor.actions.push("completed");
        }
      } else {
        // Add as new contributor
        task.contributors.push({
          userId: userId,
          name: user.name,
          email: user.email,
          role: user.role,
          addedAt: new Date(),
          contributionType: "updater",
          actions: ["completed"],
        });
      }

      await task.save();

      // Create contribution record
      await this.createContribution({
        user,
        action: "task_completed",
        resourceType: "task",
        resourceId: task._id.toString(),
        resourceName: task.title,
        projectId: task.projectId?.toString(),
        description: `Completed task "${task.title}"`,
        impact: "high",
      });

      // Update contributor stats
      await this.updateContributorStats(userId, {
        $inc: { "stats.totalTasksCompleted": 1 },
        $set: { "stats.lastContributionAt": new Date() },
      });
    } catch (error) {
      console.error("[ContributionTracker] Error tracking task completion:", error);
    }
  }

  /**
   * Track task assignment
   */
  async trackTaskAssignment(task, assigner, assignee) {
    try {
      await this.ensureContributor(assigner);

      // Add assignee as contributor if not already
      const assigneeId = typeof assignee === "string" ? assignee : assignee.userId || assignee.id;
      const isNewContributor = !task.contributors.some((c) => c.userId === assigneeId);

      if (isNewContributor) {
        task.contributors.push({
          userId: assigneeId,
          name: typeof assignee === "string" ? assignee : assignee.name,
          email: typeof assignee === "string" ? "" : assignee.email,
          role: typeof assignee === "string" ? "employee" : assignee.role,
          addedAt: new Date(),
          contributionType: "assignee",
          actions: ["assigned"],
        });

        await task.save();
      }

      // Create contribution record for assignment
      await this.createContribution({
        user: assigner,
        action: "task_assigned",
        resourceType: "task",
        resourceId: task._id.toString(),
        resourceName: task.title,
        projectId: task.projectId?.toString(),
        description: `Assigned task "${task.title}" to ${typeof assignee === "string" ? assignee : assignee.name}`,
        impact: "medium",
      });
    } catch (error) {
      console.error("[ContributionTracker] Error tracking task assignment:", error);
    }
  }

  /**
   * Track comment added to task
   */
  async trackTaskComment(task, user, commentText) {
    try {
      await this.ensureContributor(user);

      const userId = user.userId || user.id;
      const contributor = task.contributors.find((c) => c.userId === userId);

      if (contributor && !contributor.actions.includes("commented")) {
        contributor.actions.push("commented");
        await task.save();
      }

      await this.createContribution({
        user,
        action: "task_comment_added",
        resourceType: "task",
        resourceId: task._id.toString(),
        resourceName: task.title,
        projectId: task.projectId?.toString(),
        description: `Added comment to task "${task.title}"`,
        impact: "low",
      });
    } catch (error) {
      console.error("[ContributionTracker] Error tracking comment:", error);
    }
  }

  /**
   * Ensure a contributor exists in the database
   */
  async ensureContributor(user) {
    const userId = user.userId || user.id;
    if (!userId) return;

    try {
      let contributor = await Contributor.findOne({ userId });

      // Extract name from various possible fields
      const userName = user.name || user.username || user.displayName || user.fullName || user.sub || "Unknown";

      if (!contributor) {
        contributor = new Contributor({
          userId: userId,
          name: userName,
          email: user.email || "",
          role: user.role || "employee",
          status: "active",
          stats: {
            totalTasksCreated: 0,
            totalTasksUpdated: 0,
            totalTasksCompleted: 0,
            totalProjectsContributed: 0,
            totalTimeSpent: 0,
          },
        });
        await contributor.save();
      } else if (!contributor.name || contributor.name === "Unknown") {
        // Update existing contributor if name is missing
        contributor.name = userName;
        contributor.email = user.email || contributor.email;
        contributor.role = user.role || contributor.role;
        await contributor.save();
      }

      return contributor;
    } catch (error) {
      console.error("[ContributionTracker] Error ensuring contributor:", error);
    }
  }

  /**
   * Create a contribution record
   */
  async createContribution({
    user,
    action,
    resourceType,
    resourceId,
    resourceName,
    projectId,
    projectName,
    description,
    changes,
    impact,
    metadata,
  }) {
    try {
      const contribution = new Contribution({
        contributorId: user.userId || user.id,
        contributorName: user.name || user.username,
        contributorEmail: user.email || "",
        contributorRole: user.role || "employee",
        action,
        resourceType,
        resourceId,
        resourceName,
        projectId,
        projectName,
        description,
        changes,
        impact,
        metadata,
      });

      await contribution.save();
      return contribution;
    } catch (error) {
      console.error("[ContributionTracker] Error creating contribution:", error);
    }
  }

  /**
   * Update contributor statistics
   */
  async updateContributorStats(userId, update) {
    try {
      await Contributor.findOneAndUpdate({ userId }, update, { upsert: true });
    } catch (error) {
      console.error("[ContributionTracker] Error updating stats:", error);
    }
  }

  /**
   * Get contributors for a task
   */
  async getTaskContributors(taskId) {
    try {
      const task = await Task.findById(taskId).lean();
      if (!task) return [];
      return task.contributors || [];
    } catch (error) {
      console.error("[ContributionTracker] Error getting task contributors:", error);
      return [];
    }
  }

  /**
   * Get contribution history for a task
   */
  async getTaskContributionHistory(taskId, limit = 50) {
    try {
      const contributions = await Contribution.find({
        resourceType: "task",
        resourceId: taskId,
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return contributions;
    } catch (error) {
      console.error("[ContributionTracker] Error getting contribution history:", error);
      return [];
    }
  }

  /**
   * Get top contributors
   */
  async getTopContributors(limit = 10, filters = {}) {
    try {
      const query = { status: "active" };
      if (filters.role) query.role = filters.role;
      if (filters.projectId) query["projects.projectId"] = filters.projectId;

      const contributors = await Contributor.find(query)
        .sort({ "stats.totalTasksCompleted": -1, "stats.totalTasksUpdated": -1 })
        .limit(limit)
        .lean();

      return contributors;
    } catch (error) {
      console.error("[ContributionTracker] Error getting top contributors:", error);
      return [];
    }
  }

  /**
   * Get project contributors with stats
   */
  async getProjectContributors(projectId) {
    try {
      // Get all contributions for this project
      const contributions = await Contribution.find({ projectId })
        .sort({ createdAt: -1 })
        .lean();

      // Group by contributor
      const contributorMap = new Map();

      contributions.forEach((contrib) => {
        const id = contrib.contributorId;
        if (!contributorMap.has(id)) {
          contributorMap.set(id, {
            userId: id,
            name: contrib.contributorName,
            email: contrib.contributorEmail,
            role: contrib.contributorRole,
            contributions: [],
            stats: {
              tasksCreated: 0,
              tasksUpdated: 0,
              tasksCompleted: 0,
              totalContributions: 0,
            },
          });
        }

        const contributor = contributorMap.get(id);
        contributor.contributions.push(contrib);
        contributor.stats.totalContributions++;

        // Count by action type
        if (contrib.action === "task_created") contributor.stats.tasksCreated++;
        else if (contrib.action === "task_completed") contributor.stats.tasksCompleted++;
        else if (contrib.action === "task_updated" || contrib.action === "task_status_changed")
          contributor.stats.tasksUpdated++;
      });

      return Array.from(contributorMap.values()).sort(
        (a, b) => b.stats.totalContributions - a.stats.totalContributions
      );
    } catch (error) {
      console.error("[ContributionTracker] Error getting project contributors:", error);
      return [];
    }
  }

  /**
   * Search contributors
   */
  async searchContributors(searchTerm, filters = {}, limit = 20) {
    try {
      const query = { status: "active" };

      if (searchTerm) {
        query.$or = [
          { name: { $regex: searchTerm, $options: "i" } },
          { email: { $regex: searchTerm, $options: "i" } },
        ];
      }

      if (filters.role) query.role = filters.role;
      if (filters.projectId) query["projects.projectId"] = filters.projectId;

      const contributors = await Contributor.find(query)
        .limit(limit)
        .sort({ "stats.lastContributionAt": -1 })
        .lean();

      return contributors;
    } catch (error) {
      console.error("[ContributionTracker] Error searching contributors:", error);
      return [];
    }
  }
}

// Export singleton instance
module.exports = new ContributionTracker();
