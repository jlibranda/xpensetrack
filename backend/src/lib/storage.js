// src/lib/storage.js
// Optional S3-compatible object storage for receipt images.
// Works with any S3-compatible provider (Cloudflare R2, AWS S3, Railway bucket,
// MinIO) configured purely through environment variables. If not configured,
// callers fall back to storing the (compressed) image bytes in the database.
//
// Env vars:
//   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
//   S3_REGION            e.g. auto (R2) or us-east-1 (S3)
//   S3_BUCKET            bucket name
//   S3_ACCESS_KEY_ID
//   S3_SECRET_ACCESS_KEY
//   S3_FORCE_PATH_STYLE  "true" for MinIO / Railway bucket (default true)

function storageConfigured() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

let _client = null;
function getClient() {
  if (_client) return _client;
  // Lazy-require so the app still boots if the SDK isn't installed / not used.
  const { S3Client } = require('@aws-sdk/client-s3');
  _client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
  });
  return _client;
}

async function putObject(key, buffer, contentType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

async function getObject(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const out = await getClient().send(new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  }));
  // Collect the readable stream into a Buffer.
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), contentType: out.ContentType };
}

async function deleteObject(key) {
  try {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } catch (e) { /* best-effort */ }
}

module.exports = { storageConfigured, putObject, getObject, deleteObject };
