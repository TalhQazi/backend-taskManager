const crypto = require("crypto");

function getKey() {
  const raw = String(process.env.MESSAGE_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function encryptString(plaintext) {
  const key = getKey();
  if (!key) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY is missing or invalid (must be 32-byte base64 for AES-256-GCM)"
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext ?? ""), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

function decryptString(value) {
  const raw = String(value ?? "");
  if (!raw.startsWith("enc:")) return raw;

  const key = getKey();
  if (!key) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY is missing or invalid (must be 32-byte base64 for AES-256-GCM)"
    );
  }

  const payload = raw.slice(4);
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload");
  }

  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = {
  encryptString,
  decryptString,
};
