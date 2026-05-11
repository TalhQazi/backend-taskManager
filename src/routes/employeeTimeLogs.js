const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const { requireAuth } = require('../middleware/auth');

// GET /employee/time-logs - Get all time logs for authenticated employee
router.get('/time-logs', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: userId };
    if (startDate || endDate) {
      filter.clock_in = {};
      if (startDate) filter.clock_in.$gte = new Date(startDate);
      if (endDate) filter.clock_in.$lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      TimeLog.find(filter)
        .sort({ clock_in: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TimeLog.countDocuments(filter)
    ]);

    const items = logs.map(l => ({
      id: String(l._id),
      employeeId: String(l.employee_id),
      clockIn: l.clock_in,
      clockOut: l.clock_out,
      totalHours: l.total_hours,
      createdAt: l.createdAt,
    }));

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Error fetching time logs:", error);
    res.status(500).json({ error: 'Failed to fetch time logs' });
  }
});

// GET /employee/time-logs/weekly - Get weekly hours summary
router.get('/time-logs/weekly', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const { weeks = 4 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (Number(weeks) * 7));

    const logs = await TimeLog.find({
      employee_id: userId,
      clock_in: { $gte: startDate }
    }).lean();

    // Group by week
    const weeklyData = {};
    logs.forEach(log => {
      const date = new Date(log.clock_in);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { totalHours: 0, days: new Set() };
      }
      weeklyData[weekKey].totalHours += log.total_hours || 0;
      weeklyData[weekKey].days.add(date.toISOString().split('T')[0]);
    });

    const result = Object.entries(weeklyData)
      .map(([week, data]) => ({
        weekStart: week,
        totalHours: Math.round(data.totalHours * 100) / 100,
        daysWorked: data.days.size
      }))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    res.json({ items: result });
  } catch (error) {
    console.error("Error fetching weekly hours:", error);
    res.status(500).json({ error: 'Failed to fetch weekly hours' });
  }
});

// GET /employee/time-logs/summary - Get total hours summary
router.get('/time-logs/summary', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayLogs, weekLogs, monthLogs, allTimeLog] = await Promise.all([
      TimeLog.find({ employee_id: userId, clock_in: { $gte: today } }).lean(),
      TimeLog.find({ employee_id: userId, clock_in: { $gte: weekStart } }).lean(),
      TimeLog.find({ employee_id: userId, clock_in: { $gte: monthStart } }).lean(),
      TimeLog.find({ employee_id: userId }).lean()
    ]);

    const sumHours = (logs) => logs.reduce((sum, l) => sum + (l.total_hours || 0), 0);

    res.json({
      today: Math.round(sumHours(todayLogs) * 100) / 100,
      thisWeek: Math.round(sumHours(weekLogs) * 100) / 100,
      thisMonth: Math.round(sumHours(monthLogs) * 100) / 100,
      allTime: Math.round(sumHours(allTimeLog) * 100) / 100
    });
  } catch (error) {
    console.error("Error fetching time log summary:", error);
    res.status(500).json({ error: 'Failed to fetch time log summary' });
  }
});

module.exports = router;