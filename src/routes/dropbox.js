// Dropbox Integration Routes (OAuth 2.0 & API Proxy)
// Tokens are encrypted at rest; files are referenced, not stored.
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const DropboxToken = require("../models/DropboxToken");
const { encrypt, decrypt, safeDecrypt } = require("../lib/encryption");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ROLE_GROUPS } = require("../constants/roles");

const router = express.Router();

// ── Configuration ────────────────────────────────────────────
const DROPBOX_CONFIG = Object.freeze({
  AUTH_URL: "https://www.dropbox.com/oauth2/authorize",
  TOKEN_URL: "https://api.dropboxapi.com/oauth2/token",
  API_URL: "https://api.dropboxapi.com/2",
  CONTENT_URL: "https://content.dropboxapi.com/2",
  /** Timeout for all Dropbox API calls (ms) */
  API_TIMEOUT_MS: 15_000,
  /** Buffer before token expiry to trigger refresh (ms) */
  TOKEN_REFRESH_BUFFER_MS: 5 * 60 * 1000,
  /** Max entries per folder listing */
  LIST_FOLDER_LIMIT: 100,
});

/** Roles allowed to use Dropbox integration */
const DROPBOX_ALLOWED_ROLES = ROLE_GROUPS.DROPBOX_ALLOWED;

// ── Helpers ──────────────────────────────────────────────────

// Extract authenticated userId
function getUserId(req) {
  return String(req.user?.sub || req.user?.id || "");
}

// Get Dropbox credentials
function getCredentials() {
  return {
    clientId: process.env.DROPBOX_APP_KEY || "",
    clientSecret: process.env.DROPBOX_APP_SECRET || "",
    redirectUri: process.env.DROPBOX_REDIRECT_URI || "http://localhost:5000/api/dropbox/callback",
  };
}

// Validate and sanitize Dropbox path
function validatePath(path) {
  if (path === "" || path === undefined || path === null) {
    return { valid: true, sanitized: "" };
  }

  const strPath = String(path);

  // Reject null bytes
  if (strPath.includes("\0")) {
    return { valid: false, sanitized: "", error: "Path contains invalid characters" };
  }

  // Reject path traversal
  if (strPath.includes("..")) {
    return { valid: false, sanitized: "", error: "Path traversal is not allowed" };
  }

  // Dropbox paths must start with "/" (except root which is "")
  if (strPath !== "" && !strPath.startsWith("/")) {
    return { valid: false, sanitized: "", error: "Path must start with /" };
  }

  // Limit path length
  if (strPath.length > 2000) {
    return { valid: false, sanitized: "", error: "Path is too long (max 2000 chars)" };
  }

  return { valid: true, sanitized: strPath };
}

// Generate HMAC-signed CSRF state token
function generateOAuthState(userId) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ userId, nonce, ts: Date.now() });
  const secret = process.env.JWT_SECRET || "";
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const stateObj = JSON.stringify({ payload, signature });
  return Buffer.from(stateObj).toString("base64url");
}

// Verify and decode HMAC-signed CSRF state token
function verifyOAuthState(state) {
  try {
    const stateObj = JSON.parse(Buffer.from(String(state), "base64url").toString("utf8"));
    const { payload, signature } = stateObj;

    if (!payload || !signature) {
      return { valid: false, error: "Malformed state token" };
    }

    // Verify HMAC signature
    const secret = process.env.JWT_SECRET || "";
    const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // Timing-safe comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSig, "hex"))) {
      return { valid: false, error: "Invalid state signature — possible CSRF attack" };
    }

    const data = JSON.parse(payload);

    // Reject states older than 10 minutes
    const maxAge = 10 * 60 * 1000;
    if (Date.now() - data.ts > maxAge) {
      return { valid: false, error: "State token has expired" };
    }

    if (!data.userId) {
      return { valid: false, error: "Missing userId in state" };
    }

    return { valid: true, userId: data.userId };
  } catch {
    return { valid: false, error: "Failed to parse state token" };
  }
}

// Authenticated POST request to Dropbox API
async function dropboxApiPost(accessToken, endpoint, body = {}) {
  try {
    const response = await axios.post(endpoint, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: DROPBOX_CONFIG.API_TIMEOUT_MS,
    });
    return response.data;
  } catch (err) {
    // Extract Dropbox-specific error details
    const dbxError = err.response?.data?.error_summary || err.response?.data?.error || "";
    const status = err.response?.status;

    if (status === 401 || String(dbxError).includes("expired_access_token")) {
      throw Object.assign(new Error("Dropbox token has expired. Please reconnect."), { statusCode: 401 });
    }
    if (String(dbxError).includes("path/not_found")) {
      throw Object.assign(new Error("File or folder not found in Dropbox."), { statusCode: 404 });
    }
    if (String(dbxError).includes("path/malformed")) {
      throw Object.assign(new Error("Invalid file path."), { statusCode: 422 });
    }
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      throw Object.assign(new Error("Dropbox API request timed out. Please try again."), { statusCode: 504 });
    }

    // Generic upstream failure
    console.error("[Dropbox] API error:", { endpoint, status, error: dbxError });
    throw Object.assign(
      new Error(dbxError || "Dropbox API request failed"),
      { statusCode: status >= 500 ? 502 : (status || 500) }
    );
  }
}

// Get non-expired Dropbox access token (auto-refreshes if needed)
async function getValidAccessToken(userId) {
  const tokenDoc = await DropboxToken.findOne({ userId });
  if (!tokenDoc) {
    throw Object.assign(
      new Error("Dropbox not connected. Please authenticate first."),
      { statusCode: 401 }
    );
  }

  // Check if token is still valid (with buffer)
  const now = Date.now();
  if (tokenDoc.expiresAt && tokenDoc.expiresAt.getTime() - DROPBOX_CONFIG.TOKEN_REFRESH_BUFFER_MS > now) {
    const token = safeDecrypt(tokenDoc.accessToken);
    if (token) return token;
    // If safeDecrypt returned null, the stored token is corrupted — try refresh
    console.warn(`[Dropbox] Stored access token for user ${userId} could not be decrypted, attempting refresh`);
  }

  // Token expired or corrupted — refresh it
  console.log(`[Dropbox] Refreshing token for user ${userId}`);
  const refreshToken = safeDecrypt(tokenDoc.refreshToken);
  if (!refreshToken) {
    // Both tokens corrupted — user needs to re-authenticate
    await DropboxToken.deleteOne({ userId });
    throw Object.assign(
      new Error("Dropbox tokens are corrupted. Please reconnect your Dropbox account."),
      { statusCode: 401 }
    );
  }

  const creds = getCredentials();
  const response = await axios.post(
    DROPBOX_CONFIG.TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: DROPBOX_CONFIG.API_TIMEOUT_MS,
    }
  );

  const { access_token, expires_in } = response.data;
  if (!access_token) {
    throw Object.assign(
      new Error("Failed to refresh Dropbox access token."),
      { statusCode: 502 }
    );
  }

  // Update stored token
  const encryptedAccess = encrypt(access_token);
  const expiresAt = new Date(Date.now() + (expires_in || 14400) * 1000);

  await DropboxToken.findOneAndUpdate(
    { userId },
    { accessToken: encryptedAccess, expiresAt }
  );

  return access_token;
}

/**
 * Middleware: restrict Dropbox routes to allowed roles.
 * Super Admin, Admin, and Manager can use Dropbox; others are rejected.
 */
const requireDropboxRole = requireRole(DROPBOX_ALLOWED_ROLES);

// GET /auth-url — Generate OAuth Authorization URL
router.get("/auth-url", requireAuth, requireDropboxRole, (req, res) => {
  try {
    const creds = getCredentials();
    if (!creds.clientId) {
      return res.status(500).json({ error: { message: "Dropbox App Key is not configured on the server." } });
    }

    const userId = getUserId(req);
    const state = generateOAuthState(userId);

    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: "code",
      redirect_uri: creds.redirectUri,
      token_access_type: "offline", // Ensures we get a refresh_token
      state,
    });

    const authUrl = `${DROPBOX_CONFIG.AUTH_URL}?${params.toString()}`;
    return res.json({ authUrl });
  } catch (err) {
    console.error("[Dropbox] auth-url error:", err.message);
    return res.status(500).json({ error: { message: "Failed to generate auth URL" } });
  }
});

// GET /callback — OAuth Redirect Handler
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter.");
    }

    // Verify CSRF state token (HMAC signature + expiry)
    const stateResult = verifyOAuthState(state);
    if (!stateResult.valid) {
      console.warn("[Dropbox] OAuth state verification failed:", stateResult.error);
      return res.status(400).send(`Authentication failed: ${stateResult.error}`);
    }

    const userId = stateResult.userId;

    // Exchange code for tokens
    const creds = getCredentials();
    const tokenResponse = await axios.post(
      DROPBOX_CONFIG.TOKEN_URL,
      new URLSearchParams({
        code: String(code),
        grant_type: "authorization_code",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: DROPBOX_CONFIG.API_TIMEOUT_MS,
      }
    );

    const { access_token, refresh_token, expires_in, account_id } = tokenResponse.data;

    if (!access_token || !refresh_token) {
      console.error("[Dropbox] Token exchange returned incomplete data");
      return res.status(502).send("Failed to obtain tokens from Dropbox.");
    }

    // Encrypt tokens before storing
    const encryptedAccess = encrypt(access_token);
    const encryptedRefresh = encrypt(refresh_token);
    const expiresAt = new Date(Date.now() + (expires_in || 14400) * 1000);

    // Upsert — one token document per user
    await DropboxToken.findOneAndUpdate(
      { userId },
      {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
        dropboxAccountId: account_id || "",
      },
      { upsert: true, new: true }
    );

    // Close the popup window and notify the opener
    return res.send(`
      <html>
        <body>
          <p>Dropbox connected successfully! This window will close automatically.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: "DROPBOX_AUTH_SUCCESS" }, "*");
            }
            setTimeout(function() { window.close(); }, 1500);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    // Redact sensitive data — only log the error message, not token values
    console.error("[Dropbox] callback error:", err.message);
    return res.status(502).send("Dropbox authentication failed. Please try again.");
  }
});

// GET /status — Check Dropbox connection status
router.get("/status", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const token = await DropboxToken.findOne({ userId }).select("_id").lean();
    return res.json({ connected: !!token });
  } catch (err) {
    console.error("[Dropbox] status check error:", err.message);
    return res.status(500).json({ error: { message: "Failed to check Dropbox status" } });
  }
});

// POST /revoke — Disconnect Dropbox
router.post("/revoke", requireAuth, requireDropboxRole, async (req, res) => {
  try {
    const userId = getUserId(req);
    const tokenDoc = await DropboxToken.findOne({ userId });
    if (!tokenDoc) {
      return res.json({ success: true, message: "No Dropbox connection to revoke." });
    }

    // Attempt to revoke on Dropbox's side (best-effort, don't block on failure)
    try {
      const accessToken = safeDecrypt(tokenDoc.accessToken);
      if (accessToken) {
        await axios.post(
          "https://api.dropboxapi.com/2/auth/token/revoke",
          null,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: DROPBOX_CONFIG.API_TIMEOUT_MS,
          }
        );
      }
    } catch (revokeErr) {
      // Token may already be invalid — that's fine, we'll delete locally anyway
      console.warn("[Dropbox] Remote revoke failed (non-blocking):", revokeErr.message);
    }

    // Delete from our DB regardless
    await DropboxToken.deleteOne({ userId });
    return res.json({ success: true });
  } catch (err) {
    console.error("[Dropbox] revoke error:", err.message);
    return res.status(500).json({ error: { message: "Failed to revoke Dropbox access" } });
  }
});

// POST /files/list — List contents of a Dropbox folder
router.post("/files/list", requireAuth, requireDropboxRole, async (req, res) => {
  try {
    const userId = getUserId(req);
    const accessToken = await getValidAccessToken(userId);

    // Validate and sanitize the folder path
    const pathResult = validatePath(req.body.path);
    if (!pathResult.valid) {
      return res.status(422).json({ error: { message: pathResult.error } });
    }

    const data = await dropboxApiPost(
      accessToken,
      `${DROPBOX_CONFIG.API_URL}/files/list_folder`,
      {
        path: pathResult.sanitized,
        recursive: false,
        include_media_info: false,
        include_deleted: false,
        limit: DROPBOX_CONFIG.LIST_FOLDER_LIMIT,
      }
    );

    // Normalize Dropbox entries to a consistent shape
    const entries = (data.entries || []).map((entry) => ({
      id: entry.id || "",
      name: entry.name || "",
      path: entry.path_lower || entry.path_display || "",
      pathDisplay: entry.path_display || "",
      type: entry[".tag"] || "file",
      size: entry.size || 0,
      modified: entry.server_modified || "",
    }));

    return res.json({
      entries,
      hasMore: data.has_more || false,
      cursor: data.cursor || "",
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode === 401) {
      return res.status(401).json({ error: { message: err.message } });
    }
    console.error("[Dropbox] files/list error:", err.message);
    return res.status(statusCode).json({ error: { message: err.message || "Failed to list Dropbox files" } });
  }
});

// POST /files/metadata — Get file metadata
router.post("/files/metadata", requireAuth, requireDropboxRole, async (req, res) => {
  try {
    const userId = getUserId(req);
    const accessToken = await getValidAccessToken(userId);

    // Validate path
    const pathResult = validatePath(req.body.path);
    if (!pathResult.valid) {
      return res.status(422).json({ error: { message: pathResult.error } });
    }
    if (!pathResult.sanitized) {
      return res.status(422).json({ error: { message: "File path is required" } });
    }

    const data = await dropboxApiPost(
      accessToken,
      `${DROPBOX_CONFIG.API_URL}/files/get_metadata`,
      { path: pathResult.sanitized }
    );

    return res.json({
      id: data.id || "",
      name: data.name || "",
      path: data.path_lower || data.path_display || "",
      pathDisplay: data.path_display || "",
      size: data.size || 0,
      modified: data.server_modified || "",
      contentHash: data.content_hash || "",
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    console.error("[Dropbox] files/metadata error:", err.message);
    return res.status(statusCode).json({ error: { message: err.message || "Failed to get file metadata" } });
  }
});

// POST /files/temporary-link — Generate 4-hour direct download link
router.post("/files/temporary-link", requireAuth, requireDropboxRole, async (req, res) => {
  try {
    const userId = getUserId(req);
    const accessToken = await getValidAccessToken(userId);

    // Validate path
    const pathResult = validatePath(req.body.path);
    if (!pathResult.valid) {
      return res.status(422).json({ error: { message: pathResult.error } });
    }
    if (!pathResult.sanitized) {
      return res.status(422).json({ error: { message: "File path is required" } });
    }

    const data = await dropboxApiPost(
      accessToken,
      `${DROPBOX_CONFIG.API_URL}/files/get_temporary_link`,
      { path: pathResult.sanitized }
    );

    return res.json({
      link: data.link || "",
      metadata: {
        id: data.metadata?.id || "",
        name: data.metadata?.name || "",
        size: data.metadata?.size || 0,
        path: data.metadata?.path_lower || "",
      },
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    console.error("[Dropbox] files/temporary-link error:", err.message);
    return res.status(statusCode).json({ error: { message: err.message || "Failed to generate temporary link" } });
  }
});

module.exports = router;
