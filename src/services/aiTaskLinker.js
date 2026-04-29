const Task = require("../models/Task");
const EODReport = require("../models/EODReport");

/**
 * AI Task Linking Service
 * Extracts potential task references from EOD text and matches them to actual tasks
 */

/**
 * Extract potential task mentions from text using keyword matching
 * This is a basic implementation - can be enhanced with NLP/AI later
 * @param {string} text - EOD report text
 * @returns {string[]} Array of potential task keywords
 */
function extractTaskKeywords(text) {
  if (!text || typeof text !== "string") return [];

  const keywords = [];
  
  // Common task-related patterns
  const patterns = [
    // "Task #123" or "Task 123"
    /task\s*#?\s*(\d+)/gi,
    // "Ticket #123" or "Ticket 123"
    /ticket\s*#?\s*(\d+)/gi,
    // "Issue #123"
    /issue\s*#?\s*(\d+)/gi,
    // "Project X"
    /project\s+(\w+)/gi,
    // "Fixed bug in..."
    /fixed\s+(?:the\s+)?(?:bug|issue)\s+(?:in\s+)?([\w\s]+?)(?:\.|,|;|$)/gi,
    // "Completed..."
    /completed\s+(?:the\s+)?([\w\s]+?)(?:\.|,|;|$)/gi,
    // "Worked on..."
    /worked\s+on\s+(?:the\s+)?([\w\s]+?)(?:\.|,|;|$)/gi,
    // "Implemented..."
    /implemented\s+(?:the\s+)?([\w\s]+?)(?:\.|,|;|$)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const keyword = match[1] || match[0];
      if (keyword && keyword.length > 3) {
        keywords.push(keyword.toLowerCase().trim());
      }
    }
  }

  // Also extract capitalized phrases (potential proper nouns/project names)
  const capitalizedPattern = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/g;
  let capMatch;
  while ((capMatch = capitalizedPattern.exec(text)) !== null) {
    if (capMatch[1].length > 3 && !["The", "This", "That", "With", "From", "When", "Where"].includes(capMatch[1])) {
      keywords.push(capMatch[1].toLowerCase());
    }
  }

  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Calculate similarity score between two strings (0-1)
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number}
 */
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1;
  
  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Word overlap
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const intersection = words1.filter(w => words2.includes(w));
  const union = [...new Set([...words1, ...words2])];
  
  return intersection.length / union.length;
}

/**
 * Find matching tasks for EOD report
 * @param {string} userId 
 * @param {string} eodText 
 * @param {Date} date - Report date
 * @returns {Promise<string[]>} Array of matching task IDs
 */
async function findMatchingTasks(userId, eodText, date) {
  if (!eodText || !userId) return [];

  try {
    // Get keywords from EOD text
    const keywords = extractTaskKeywords(eodText);
    if (keywords.length === 0) return [];

    // Get user's active tasks from the past week (to find relevant ones)
    const weekAgo = new Date(date);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const tasks = await Task.find({
      $or: [
        { assignees: userId },
        { createdBy: userId },
      ],
      updatedAt: { $gte: weekAgo },
      status: { $in: ["in_progress", "completed", "in_review"] },
    }).select("_id title description taskId").lean();

    const matchedTaskIds = [];
    const matchScores = [];

    for (const task of tasks) {
      let maxScore = 0;

      // Check title similarity
      const titleScore = Math.max(
        ...keywords.map(k => calculateSimilarity(k, task.title || ""))
      );
      maxScore = Math.max(maxScore, titleScore);

      // Check description similarity
      if (task.description) {
        const descScore = Math.max(
          ...keywords.map(k => calculateSimilarity(k, task.description))
        );
        maxScore = Math.max(maxScore, descScore);
      }

      // Check task ID mentions
      if (task.taskId) {
        const idMentions = keywords.filter(k => k.includes(task.taskId.toLowerCase()));
        if (idMentions.length > 0) {
          maxScore = Math.max(maxScore, 0.9);
        }
      }

      // Threshold for matching (0.6 = 60% similarity)
      if (maxScore >= 0.6) {
        matchedTaskIds.push(String(task._id));
        matchScores.push({
          taskId: String(task._id),
          title: task.title,
          score: maxScore,
        });
      }
    }

    // Sort by score and return top matches
    matchScores.sort((a, b) => b.score - a.score);
    
    console.log(`[AITaskLinker] Found ${matchedTaskIds.length} matching tasks for user ${userId}`);
    console.log(`[AITaskLinker] Top matches:`, matchScores.slice(0, 3));

    return matchedTaskIds;
  } catch (error) {
    console.error("[AITaskLinker] Error finding matching tasks:", error);
    return [];
  }
}

/**
 * Process EOD report and link tasks
 * Updates the EOD report with tagged tasks
 * @param {string} eodReportId 
 * @param {string} userId 
 * @param {string} eodText 
 * @param {Date} date 
 * @returns {Promise<{linkedTasks: string[], confidence: number}>}
 */
async function processAndLinkTasks(eodReportId, userId, eodText, date) {
  try {
    const linkedTaskIds = await findMatchingTasks(userId, eodText, date);

    if (linkedTaskIds.length > 0) {
      await EODReport.findByIdAndUpdate(eodReportId, {
        taggedTasks: linkedTaskIds,
      });
    }

    // Calculate confidence (average match score)
    const confidence = linkedTaskIds.length > 0 
      ? Math.min(1, linkedTaskIds.length * 0.25 + 0.5) 
      : 0;

    return {
      linkedTasks: linkedTaskIds,
      confidence,
    };
  } catch (error) {
    console.error("[AITaskLinker] Error processing and linking tasks:", error);
    return { linkedTasks: [], confidence: 0 };
  }
}

/**
 * Get task suggestions for autocomplete while typing EOD
 * @param {string} userId 
 * @param {string} partialText 
 * @returns {Promise<Array<{_id: string, title: string, score: number}>>}
 */
async function getTaskSuggestions(userId, partialText) {
  if (!partialText || partialText.length < 3) return [];

  try {
    const tasks = await Task.find({
      $or: [
        { assignees: userId },
        { createdBy: userId },
      ],
      status: { $in: ["in_progress", "todo", "in_review"] },
    }).select("_id title taskId").limit(10).lean();

    const suggestions = tasks.map(task => ({
      _id: String(task._id),
      title: task.title,
      taskId: task.taskId,
      score: calculateSimilarity(partialText, task.title),
    }));

    return suggestions
      .filter(s => s.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  } catch (error) {
    console.error("[AITaskLinker] Error getting suggestions:", error);
    return [];
  }
}

module.exports = {
  extractTaskKeywords,
  findMatchingTasks,
  processAndLinkTasks,
  getTaskSuggestions,
  calculateSimilarity,
};
