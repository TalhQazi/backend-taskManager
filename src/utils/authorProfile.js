const Settings = require("../models/Settings");
const Employee = require("../models/Employee");

/**
 * Resolve display name + avatar for comment authors, consistently for ALL roles
 * (super-admin, admin, manager, employee, etc.).
 *
 * Every user logs in via the Employee collection, so Employee.name is the
 * authoritative full name and is always present. Avatars are only stored in the
 * Settings collection (keyed by userId === Employee._id). Settings.fullName is
 * optional (only set if the user edited their profile), so we fall back to
 * Employee.name to avoid ever showing a raw email/username in the UI.
 *
 * @param {Array<string>} userIds - author user ids (Employee._id as string)
 * @returns {Promise<Object>} map of userId -> { fullName, avatar }
 */
async function getAuthorProfileMap(userIds) {
  const ids = [...new Set((userIds || []).map((id) => String(id || "")))].filter(Boolean);
  if (ids.length === 0) return {};

  const [settingsList, employees] = await Promise.all([
    Settings.find({ userId: { $in: ids } })
      .select("userId fullName avatarDataUrl avatarUrl")
      .lean(),
    Employee.find({ _id: { $in: ids } })
      .select("_id name")
      .lean(),
  ]);

  const settingsMap = {};
  settingsList.forEach((s) => {
    settingsMap[String(s.userId)] = s;
  });
  const employeeMap = {};
  employees.forEach((e) => {
    employeeMap[String(e._id)] = e;
  });

  const result = {};
  ids.forEach((id) => {
    const s = settingsMap[id];
    const e = employeeMap[id];
    result[id] = {
      fullName: (s && s.fullName) || (e && e.name) || "",
      avatar: (s && (s.avatarDataUrl || s.avatarUrl)) || "",
    };
  });
  return result;
}

/**
 * Resolve display name + avatar for a single author.
 * @param {string} userId
 * @returns {Promise<{ fullName: string, avatar: string }>}
 */
async function getAuthorProfile(userId) {
  const map = await getAuthorProfileMap([userId]);
  return map[String(userId || "")] || { fullName: "", avatar: "" };
}

module.exports = { getAuthorProfileMap, getAuthorProfile };
