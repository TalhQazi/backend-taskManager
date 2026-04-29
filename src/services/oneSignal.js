/**
 * OneSignal Push Notification Service
 * 
 * This is a placeholder integration for OneSignal push notifications.
 * To enable OneSignal:
 * 1. Add these environment variables to your .env file:
 *    - ONESIGNAL_APP_ID=your_app_id
 *    - ONESIGNAL_API_KEY=your_api_key
 *    - ONESIGNAL_ENABLED=true
 * 2. Ensure users have their OneSignal player IDs stored in their User document
 */

const axios = require("axios");

function isOneSignalEnabled() {
  return (
    process.env.ONESIGNAL_ENABLED === "true" &&
    process.env.ONESIGNAL_APP_ID &&
    process.env.ONESIGNAL_API_KEY
  );
}

/**
 * Send a push notification via OneSignal
 * @param {Object} options
 * @param {string[]} options.playerIds - OneSignal player IDs to send to
 * @param {string} options.heading - Notification title
 * @param {string} options.content - Notification body
 * @param {Object} [options.data] - Additional data payload
 * @param {string} [options.url] - URL to open when clicked
 */
async function sendPushNotification({ playerIds, heading, content, data = {}, url }) {
  if (!isOneSignalEnabled()) {
    console.log("[OneSignal] Not enabled - skipping push notification");
    return { success: false, reason: "not_enabled" };
  }

  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    console.log("[OneSignal] No player IDs provided - skipping push notification");
    return { success: false, reason: "no_recipients" };
  }

  try {
    const response = await axios.post(
      "https://onesignal.com/api/v1/notifications",
      {
        app_id: process.env.ONESIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings: { en: heading },
        contents: { en: content },
        data,
        url,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
        },
      }
    );

    console.log("[OneSignal] Push notification sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("[OneSignal] Failed to send push notification:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send push notification to a user by their OneSignal player ID(s)
 * This assumes the User document has a `oneSignalPlayerIds` array field
 * @param {string} userId - User ID
 * @param {Object} notification - Notification object
 */
async function sendToUser(userId, notification) {
  const User = require("../models/User");
  
  const user = await User.findById(userId).select("oneSignalPlayerIds").lean();
  if (!user || !Array.isArray(user.oneSignalPlayerIds) || user.oneSignalPlayerIds.length === 0) {
    console.log(`[OneSignal] No player IDs found for user ${userId}`);
    return { success: false, reason: "no_player_ids" };
  }

  return sendPushNotification({
    playerIds: user.oneSignalPlayerIds,
    heading: notification.heading,
    content: notification.content,
    data: notification.data,
    url: notification.url,
  });
}

module.exports = {
  sendPushNotification,
  sendToUser,
  isOneSignalEnabled,
};
