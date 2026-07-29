const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");

let s3Client;
const hasAwsConfig = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

if (hasAwsConfig) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
  };
  return mimes[ext] || "application/octet-stream";
};

/**
 * Upload a file buffer to S3 (or local disk if S3 is not configured)
 * @param {Buffer} buffer - File data
 * @param {string} originalName - Original filename
 * @param {string} mimeType - File mime type
 * @param {string} folder - Folder in bucket (optional)
 * @returns {Promise<string>} - The S3 URL or local relative URL of the uploaded file
 */
async function uploadToS3(buffer, originalName, mimeType, folder = "uploads") {
  return saveToServer(buffer, originalName, mimeType, folder);
}

/**
 * Save a file buffer to the local server disk (never uses S3, regardless of AWS config).
 * Returns a relative "/uploads/{folder}/{name}" URL, served by Express static and by the
 * /api/s3-proxy/* endpoint (which checks local disk first).
 * @param {Buffer} buffer - File data
 * @param {string} originalName - Original filename (used for extension)
 * @param {string} mimeType - File mime type (unused on disk, kept for signature parity)
 * @param {string} folder - Sub-folder under uploads/
 * @returns {Promise<string>} - Relative URL of the saved file
 */
async function saveToServer(buffer, originalName, mimeType, folder = "uploads") {
  let fileExtension = path.extname(originalName || "");
  if (!fileExtension) {
    // Derive a sensible extension from the mime type (e.g. video/webm -> .webm)
    const subtype = String(mimeType || "").split("/")[1] || "";
    if (subtype) fileExtension = `.${subtype.split(";")[0]}`;
  }
  const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${fileExtension}`;
  const destPath = path.join(__dirname, "../../uploads", folder, uniqueName);

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);

  console.log(`[File System] Saved upload to server: ${folder}/${uniqueName}`);
  return `/uploads/${folder}/${uniqueName}`;
}

/**
 * Delete a file from S3 or local disk by URL
 * @param {string} url - Entire URL of the file
 */
async function deleteFromS3(url) {
  try {
    if (!url) return;

    // Local file deletion
    if (url.startsWith("/uploads/")) {
      const relativePath = url.replace(/^\/uploads\//, "");
      const localPath = path.join(__dirname, "../../uploads", relativePath);
      if (fs.existsSync(localPath)) {
        await fs.promises.unlink(localPath);
        console.log(`[File System] Deleted local file: ${localPath}`);
      }
      return;
    }

    if (!hasAwsConfig || !url.includes("amazonaws.com")) return;
    
    const bucketName = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    if (!bucketName) return;
    const region = process.env.AWS_REGION || "us-east-1";
    
    const urlPattern = new RegExp(`https://${bucketName}.s3.${region}.amazonaws.com/(.*)`);
    const match = url.match(urlPattern);
    if (!match) return;
    
    const key = match[1];

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3Client.send(command);
  } catch (err) {
    console.error("Failed to delete file:", err);
  }
}

/**
 * Get a file from local disk or S3 by its key and return the readable stream + content type.
 * Used to proxy S3 files through the backend API to avoid CORS issues.
 * @param {string} key - The S3 object key (e.g. "projects/logos/1234-abc.png")
 * @returns {Promise<{stream: ReadableStream, contentType: string, contentLength: number}>}
 */
async function getFromS3(key) {
  // Check if file is available locally on disk first
  const localPath = path.join(__dirname, "../../uploads", key);
  if (fs.existsSync(localPath)) {
    console.log(`[File System] Serving proxied file from local disk: ${key}`);
    const contentType = getMimeType(localPath);
    const stats = fs.statSync(localPath);
    return {
      stream: fs.createReadStream(localPath),
      contentType,
      contentLength: stats.size,
    };
  }

  // Fallback to AWS S3 if config is present
  if (hasAwsConfig) {
    const bucketName = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    if (!bucketName) {
      throw new Error("AWS S3 bucket name missing in environment variables");
    }
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const response = await s3Client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength || 0,
    };
  }

  throw new Error(`File not found: ${key} (Local file missing and S3 credentials not configured)`);
}

/**
 * Extract the S3 object key from a full S3 URL.
 * @param {string} url - Full S3 URL
 * @returns {string|null} - The object key, or null if not a valid S3 URL
 */
function extractS3Key(url) {
  if (!url) return null;
  if (url.includes("/uploads/")) {
    const idx = url.indexOf("/uploads/");
    return url.substring(idx + "/uploads/".length);
  }
  if (url.startsWith("uploads/")) {
    return url.replace(/^uploads\//, "");
  }
  if (!url.includes("amazonaws.com")) return null;
  const bucketName = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  if (!bucketName) return null;
  const region = process.env.AWS_REGION || "us-east-1";
  const pattern = new RegExp(`https://${bucketName}\\.s3\\.${region}\\.amazonaws\\.com/(.+)`);
  const match = url.match(pattern);
  return match ? match[1] : null;
}

/**
 * Helper to convert Base64 string to Buffer for S3 upload
 * @param {string} base64String - Data URI (data:image/png;base64,...)
 * @returns {{buffer: Buffer, mimeType: string}}
 */
function base64ToBuffer(base64String) {
  const matches = base64String.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 string format");
  }

  return {
    mimeType: matches[1],
    buffer: Buffer.from(matches[2], "base64"),
  };
}

module.exports = {
  uploadToS3,
  saveToServer,
  deleteFromS3,
  getFromS3,
  extractS3Key,
  base64ToBuffer,
};
