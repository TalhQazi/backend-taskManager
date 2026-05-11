const Employee = require("../models/Employee");

/**
 * Extracts mentions (@username or @email) from a text string.
 * @param {string} text The text to parse
 * @returns {Promise<string[]>} Array of mentioned usernames/emails
 */
async function extractMentions(text) {
  if (!text || typeof text !== "string" || !text.includes("@")) {
    return [];
  }

  const activeEmployees = await Employee.find({ status: "active" }).select("name email username").lean();
  const mentionedUsers = [];
  const lowerText = text.toLowerCase();

  activeEmployees.forEach(emp => {
    const handles = [emp.name, emp.email, emp.username]
      .filter(Boolean)
      .map(h => String(h).trim().toLowerCase());

    for (const handle of handles) {
      if (lowerText.includes("@" + handle) && !mentionedUsers.includes(handle)) {
        // Return the actual name/email/username used, or just prefer name
        // For consistency, we'll return the name if available, else email
        const identifier = emp.name || emp.username || emp.email;
        if (!mentionedUsers.includes(identifier)) {
          mentionedUsers.push(identifier);
        }
        break; // found this user, move to next employee
      }
    }
  });

  return mentionedUsers;
}

module.exports = { extractMentions };
