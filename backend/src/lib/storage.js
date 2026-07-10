// src/lib/storage.js
// Durable object storage for receipt / proof-of-payment files.
//
// Backend priority:
//   1) Vercel Blob   — if BLOB_READ_WRITE_TOKEN is set (uses a PRIVATE blob store)
//   2) S3-compatible — if S3_* env vars are set (Cloudflare R2, AWS S3, MinIO)
//   3) neither       — callers fall back to storing the (compressed) bytes in the DB
//
// The stored `storageKey` is the object key (S3) or the blob pathname (Vercel Blob).
// Files live outside the app container and the database, so they survive every
// deploy / schema sync.
//
// Vercel Blob env (works from Railway too — token auth):
//   BLOB_READ_WRITE_TOKEN   read-write token from a PRIVATE Vercel Blob store
//
// S3 env:
//   S3_ENDPOINT  S3_REGION  S3_BUCKET  S3_ACCESS_KEY_ID  S3_SECRET_ACCESS_KEY  S3_FORCE_PATH_STYLE

function blobConfigured() { return !!process.env.BLOB_READ_WRITE_TOKEN; }
function s3Configured() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}
function storageConfigured() { return blobConfigured() || s3Configured(); }

/* ----------------------------- Vercel Blob ------------------------------ */
const BLOB_TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN;

async function blobPut(key, buffer, contentType) {
  const { put } = require('@vercel/blob');
  const res = await put(key, buffer, {
    access: 'private',
    addRandomSuffix: false,       // keep our exact key so getObject(key) works
    contentType: contentType || 'application/octet-stream',
    token: BLOB_TOKEN(),
  });
  return res.pathname || key;
}

async function blobGet(key) {
  const { get } = require('@vercel/blob');
  const result = await get(key, { access: 'private', token: BLOB_TOKEN() });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error('Blob not found');
  const { Readable } = require('stream');
  const chunks = [];
  for await (const chunk of Readable.fromWeb(result.stream)) chunks.push(Buffer.from(chunk));
  return { buffer: Buffer.concat(chunks), contentType: result.blob?.contentType };
}

async function blobDel(key) {
  const { del } = require('@vercel/blob');
  await del(key, { token: BLOB_TOKEN() });
}

/* ------------------------------- S3 / R2 -------------------------------- */
let _client = null;
function getClient() {
  if (_client) return _client;
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

async function s3Put(key, buffer, contentType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

async function s3Get(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const out = await getClient().send(new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), contentType: out.ContentType };
}

async function s3Del(key) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

/* --------------------- Unified API (stable signatures) ------------------ */
async function putObject(key, buffer, contentType) {
  if (blobConfigured()) return blobPut(key, buffer, contentType);
  return s3Put(key, buffer, contentType);
}

async function getObject(key) {
  if (blobConfigured()) return blobGet(key);
  return s3Get(key);
}

async function deleteObject(key) {
  try {
    if (blobConfigured()) return await blobDel(key);
    return await s3Del(key);
  } catch (e) { /* best-effort: an orphaned object is harmless */ }
}

module.exports = { storageConfigured, blobConfigured, s3Configured, putObject, getObject, deleteObject };
