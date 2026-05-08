/**
 * AES-256-CBC encryption for OAuth tokens at rest.
 * Format: "iv:ciphertext" (hex-encoded).
 * Requires DROPBOX_ENCRYPTION_KEY in .env (64-char hex = 32 bytes).
 */
const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

let didWarnMissingKey = false;

function getKey() {
  const raw = process.env.DROPBOX_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    if (!didWarnMissingKey) {
      didWarnMissingKey = true;
      console.warn("[encryption] Encryption key is not set. Falling back to plaintext mode.");
    }
    return null;
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(`DROPBOX_ENCRYPTION_KEY must be 64-char hex (32 bytes). Got ${buf.length} bytes.`);
  }
  return buf;
}

function encrypt(plaintext) {
  if (!plaintext) return "";
  const key = getKey();
  if (!key) return String(plaintext);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return "";
  const key = getKey();
  if (!key) return String(encryptedText);
  const [ivHex, cipherHex] = encryptedText.split(":");
  if (!ivHex || !cipherHex) throw new Error("Invalid encrypted text format. Expected iv:ciphertext");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Returns null instead of throwing — use when a decrypt failure shouldn't crash the process
function safeDecrypt(encryptedText) {
  try {
    return decrypt(encryptedText);
  } catch (err) {
    console.error("[encryption] safeDecrypt failed:", err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt, safeDecrypt };
