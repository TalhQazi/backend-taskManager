/**
 * ClearHire® Encryption Utility
 * ─────────────────────────────
 * AES-256-GCM encryption for sensitive fields (SSN, etc.)
 *
 * Output format:  iv:authTag:ciphertext   (all hex-encoded)
 *
 * Key source (in priority order):
 *   1. ENCRYPTION_KEY env var  (64 hex chars = 32 bytes)
 *   2. Fatal error — we refuse to start with no key
 *
 * When AWS KMS is ready, swap getKey() to call KMS.decrypt()
 * on a wrapped data-key. The encrypt/decrypt interface stays the same.
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128-bit IV
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Resolve the 32-byte encryption key from environment.
 * Throws if not configured — we never silently fall back to random keys
 * because that would make encrypted data unrecoverable after restart.
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "[ClearHire Encryption] ENCRYPTION_KEY is not set in .env. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  // Accept 64-char hex string (= 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // Accept arbitrary string — hash to 32 bytes deterministically
  // (less secure than raw 32-byte key but functional for local dev)
  console.warn(
    "[ClearHire Encryption] ENCRYPTION_KEY is not 64 hex chars; " +
      "hashing with SHA-256. Use a proper 32-byte hex key in production."
  );
  return crypto.createHash("sha256").update(raw).digest();
}

// Resolve key once at startup so misconfiguration is caught early
let _key;
try {
  _key = getKey();
} catch (err) {
  // Log warning but don't crash the process — allows the server to start
  // for routes that don't need encryption. The first encrypt/decrypt call
  // will throw a clear error.
  console.warn(err.message);
  _key = null;
}

/**
 * Encrypt a plaintext string (e.g. SSN "123-45-6789").
 * @param {string} plainText
 * @returns {string} Hex-encoded "iv:authTag:ciphertext"
 */
function encryptField(plainText) {
  if (!plainText) return null;
  if (!_key) {
    // Try resolving again in case .env was loaded late
    _key = getKey(); // throws if still missing
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a previously encrypted string.
 * @param {string} encryptedText  Format: "iv:authTag:ciphertext" (hex)
 * @returns {string} Original plaintext
 */
function decryptField(encryptedText) {
  if (!encryptedText) return null;
  if (!_key) {
    _key = getKey();
  }

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "[ClearHire Encryption] Invalid encrypted format. Expected iv:authTag:ciphertext"
    );
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Mask an SSN for display — shows only last 4 digits.
 * @param {string} ssn  Plain SSN (e.g. "123-45-6789" or "123456789")
 * @returns {string}  "***-**-6789"
 */
function maskSSN(ssn) {
  if (!ssn) return "***-**-****";
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return "***-**-****";
  return `***-**-${digits.slice(-4)}`;
}

module.exports = {
  encryptField,
  decryptField,
  maskSSN,
};
