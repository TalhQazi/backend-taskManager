const Employee = require("../models/Employee");
const User = require("../models/User");

/**
 * Extracts mentions (@username or @email) from a text string.
 * Searches both Employee and User models so managers/admins can be mentioned.
 * @param {string} text The text to parse
 * @returns {Promise<string[]>} Array of mentioned identifiers (name or username)
 */
async function extractMentions(text) {
  if (!text || typeof text !== "string" || !text.includes("@")) {
    return [];
  }

  const [activeEmployees, activeUsers] = await Promise.all([
    Employee.find({ status: "active" }).select("name email username").lean(),
    User.find({ status: "active" }).select("username email name").lean(),
  ]);

  // Merge both sets, deduplicating by username/email
  const seenKeys = new Set();
  const allPeople = [];
  for (const p of [...activeEmployees, ...activeUsers]) {
    const key = (p.username || p.email || p.name || "").toLowerCase();
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      allPeople.push({ name: p.name, email: p.email, username: p.username });
    }
  }

  const mentionedUsers = [];
  const lowerText = text.toLowerCase();

  allPeople.forEach((person) => {
    const handles = [person.name, person.email, person.username]
      .filter(Boolean)
      .map((h) => String(h).trim().toLowerCase());

    for (const handle of handles) {
      if (lowerText.includes("@" + handle)) {
        const identifier = person.name || person.username || person.email;
        if (identifier && !mentionedUsers.includes(identifier)) {
          mentionedUsers.push(identifier);
        }
        break;
      }
    }
  });

  return mentionedUsers;
}

module.exports = { extractMentions };
