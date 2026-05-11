const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
dotenv.config();

let getSignedUrl = null;
let s3 = null;
let BUCKET_NAME = null;

try {
  const presigner = require('@aws-sdk/s3-request-presigner');
  getSignedUrl = presigner.getSignedUrl;
  
  s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  BUCKET_NAME = process.env.AWS_BUCKET_NAME;
} catch (err) {
  console.log("S3 presigner not available, pre-signed URLs disabled");
}

async function uploadFile(key, body) {
  if (!s3) throw new Error("S3 not configured");
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
  });
  await s3.send(command);
}

async function getPresignedUrl(key) {
  if (!s3 || !getSignedUrl) {
    throw new Error("S3 presigner not available");
  }
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3, command, { expiresIn: 3600 });
}

module.exports = { uploadFile, getPresignedUrl };