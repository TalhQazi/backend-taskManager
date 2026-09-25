/**
 * Canonical Task Manager access links for welcome / registration emails.
 * Update APPLE_STORE_URL when the iOS listing is live.
 */
const WEBSITE_LOGIN_URL =
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "https://task.se7eninc.com/login";

const GOOGLE_PLAY_URL =
  process.env.GOOGLE_PLAY_URL ||
  "https://play.google.com/store/apps/details?id=app.rork.employee_mobile_app_50y6sgn";

/** Placeholder until the Apple App Store listing is published. */
const APPLE_STORE_URL =
  process.env.APPLE_STORE_URL ||
  "https://apps.apple.com/app/task-manager-coming-soon";

function getAppAccessVariables() {
  return {
    websiteUrl: WEBSITE_LOGIN_URL,
    googlePlayUrl: GOOGLE_PLAY_URL,
    appleStoreUrl: APPLE_STORE_URL,
  };
}

function formatAppAccessSection({ websiteUrl, googlePlayUrl, appleStoreUrl } = getAppAccessVariables()) {
  return [
    "",
    "--------------------------------------------------",
    "Access Task Manager",
    "--------------------------------------------------",
    `Website (login): ${websiteUrl}`,
    `Google Play Store: ${googlePlayUrl}`,
    `Apple App Store: ${appleStoreUrl} (iOS link coming soon — placeholder)`,
    "",
  ].join("\n");
}

/** Default body text for new-user welcome emails. */
function getUserRegistrationBody() {
  const links = getAppAccessVariables();
  return [
    "Hello {name},",
    "",
    "Welcome to Task Manager. Your account has been created successfully.",
    "",
    "You can log in on the website or download the mobile app using the links below:",
    formatAppAccessSection(links).trim(),
    "",
    "Best regards,",
    "Task Manager System",
  ].join("\n");
}

function getManagerRegistrationBody() {
  const links = getAppAccessVariables();
  return [
    "Hello {name},",
    "",
    "Your manager account has been created on Task Manager. You can now log in to manage tasks and your team.",
    "",
    "Use the website or mobile apps below:",
    formatAppAccessSection(links).trim(),
    "",
    "Best regards,",
    "Task Manager System",
  ].join("\n");
}

module.exports = {
  WEBSITE_LOGIN_URL,
  GOOGLE_PLAY_URL,
  APPLE_STORE_URL,
  getAppAccessVariables,
  formatAppAccessSection,
  getUserRegistrationBody,
  getManagerRegistrationBody,
};
