const express = require("express");

const CRMContact = require("../models/CRMContact");
const CRMCompany = require("../models/CRMCompany");
const CRMDeal = require("../models/CRMDeal");
const CRMTask = require("../models/CRMTask");
const CRMCommunication = require("../models/CRMCommunication");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getStageGroup(stage) {
  switch (stage) {
    case "Qualification":
      return "Leads";
    case "Needs Analysis":
      return "Qualified";
    case "Proposal":
    case "Negotiation":
      return "Proposal";
    case "Closed Won":
      return "Won";
    default:
      return "Leads";
  }
}

function buildMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month - 1).toLocaleString("en-US", { month: "short" });
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const [contactCount, companyCount, communicationCount, totalDeals, activeDeals, wonDeals, lostDeals, totalTasks, pendingTasks] = await Promise.all([
      CRMContact.countDocuments({}),
      CRMCompany.countDocuments({}),
      CRMCommunication.countDocuments({}),
      CRMDeal.countDocuments({}),
      CRMDeal.countDocuments({ stage: { $nin: ["Closed Won", "Closed Lost"] } }),
      CRMDeal.countDocuments({ stage: "Closed Won" }),
      CRMDeal.countDocuments({ stage: "Closed Lost" }),
      CRMTask.countDocuments({}),
      CRMTask.countDocuments({ status: "Pending" }),
    ]);

    const [deals, recentTasks, recentCommunications] = await Promise.all([
      CRMDeal.find({}).lean(),
      CRMTask.find({ status: "Pending" }).sort({ dueDate: 1, createdAt: -1 }).limit(8).lean(),
      CRMCommunication.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const totalDealValue = deals.reduce((sum, deal) => sum + (deal.value || 0), 0);
    const revenue = deals
      .filter((deal) => deal.stage === "Closed Won")
      .reduce((sum, deal) => sum + (deal.value || 0), 0);
    const pipelineValue = deals
      .filter((deal) => !["Closed Won", "Closed Lost"].includes(deal.stage))
      .reduce((sum, deal) => sum + (deal.value || 0), 0);
    const averageDealSize = totalDeals ? Math.round(totalDealValue / totalDeals) : 0;

    const now = new Date();
    const months = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push(buildMonthKey(date));
    }

    const closeDateBuckets = deals.reduce((acc, deal) => {
      const date = deal.closeDate ? new Date(deal.closeDate) : new Date(deal.createdAt);
      if (!(date instanceof Date) || isNaN(date.getTime())) return acc;
      const key = buildMonthKey(date);
      if (!acc[key]) acc[key] = 0;
      acc[key] += 1;
      return acc;
    }, {});

    const monthlyDeals = months.map((key) => ({
      month: monthLabel(key),
      deals: closeDateBuckets[key] || 0,
    }));

    const stageCounts = deals.reduce(
      (acc, deal) => {
        const group = getStageGroup(deal.stage);
        acc[group] = (acc[group] || 0) + 1;
        return acc;
      },
      { Leads: 0, Qualified: 0, Proposal: 0, Won: 0 }
    );

    const totalStageCount = Object.values(stageCounts).reduce((sum, value) => sum + value, 0) || 1;
    const conversionStages = [
      { stage: "Leads", count: stageCounts.Leads, percent: Math.round((stageCounts.Leads / totalStageCount) * 100) },
      { stage: "Qualified", count: stageCounts.Qualified, percent: Math.round((stageCounts.Qualified / totalStageCount) * 100) },
      { stage: "Proposal", count: stageCounts.Proposal, percent: Math.round((stageCounts.Proposal / totalStageCount) * 100) },
      { stage: "Won", count: stageCounts.Won, percent: Math.round((stageCounts.Won / totalStageCount) * 100) },
    ];

    const formatShortDate = (date) => {
      return new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    };

    const recentActivities = [
      ...recentTasks.map((task) => ({
        id: `task-${task._id}`,
        type: "task",
        text: `Pending task: ${task.title}`,
        user: task.assignedTo || "Unassigned",
        time: `Due ${formatShortDate(task.dueDate)}`,
        avatar: (task.assignedTo || "U").slice(0, 2).toUpperCase(),
      })),
      ...recentCommunications.map((comm) => {
        const senderName = comm.createdBy && typeof comm.createdBy === 'object'
          ? comm.createdBy.name || comm.createdBy.username || String(comm.createdBy)
          : comm.createdBy || "System";

        return {
          id: `comm-${comm._id}`,
          type: "communication",
          text: comm.subject || comm.message || "New communication log",
          user: senderName,
          time: new Date(comm.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
          avatar: String(senderName).slice(0, 2).toUpperCase(),
        };
      }),
    ].slice(0, 5);

    const upcomingFollowups = recentTasks.slice(0, 4).map((task) => ({
      id: `followup-${task._id}`,
      contact: task.linkedEntity || task.title,
      task: task.title,
      date: formatShortDate(task.dueDate),
      time: new Date(task.dueDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      priority: task.priority || "Medium",
    }));

    return res.json({
      metrics: {
        contacts: contactCount,
        companies: companyCount,
        totalDeals,
        activeDeals,
        wonDeals,
        lostDeals,
        communications: communicationCount,
        activeTasks: pendingTasks,
        pipelineValue,
        revenue,
        averageDealSize,
      },
      monthlyDeals,
      conversionStages,
      recentActivities,
      upcomingFollowups,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
