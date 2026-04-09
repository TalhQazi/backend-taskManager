const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload a file buffer to S3
 * @param {Buffer} buffer - File data
 * @param {string} originalName - Original filename
 * @param {string} mimeType - File mime type
 * @param {string} folder - Folder in bucket (optional)
 * @returns {Promise<string>} - The S3 URL of the uploaded file
 */
async function uploadToS3(buffer, originalName, mimeType, folder = "uploads") {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS Credentials missing in environment variables");
  }

  const fileExtension = path.extname(originalName);
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}${fileExtension}`;
  const bucketName = process.env.AWS_S3_BUCKET_NAME;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    // Note: If you unchecked "Block Public Access", we can potentially set ACL: "public-read"
    // But many AWS accounts now forbid this at the account level. 
    // Standard practice is to serve from a public bucket or use CloudFront.
    // For now, we rely on the bucket's "Block Public Access" being OFF and a Bucket Policy allowing reads.
  });

  await s3Client.send(command);

  // Return the public URL
  return `https://${bucketName}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${fileName}`;
}

/**
 * Delete a file from S3 by URL
 * @param {string} url - Entire URL of the file
 */
async function deleteFromS3(url) {
  try {
    if (!url || !url.includes("amazonaws.com")) return;
    
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || "us-east-1";
    
    // Extract key from URL
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
    console.error("Failed to delete from S3:", err);
  }
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
  deleteFromS3,
  base64ToBuffer,
};
