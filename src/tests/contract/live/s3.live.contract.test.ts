import { afterAll, describe, expect, test } from 'vitest';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { hasS3LiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live S3 contract — the real put → head → get → copy → delete surface, plus the presigned
 * URL/POST flows exercised end to end with real HTTP.
 *
 * @remarks
 * The offline tier stubs the AWS SDK, so it proves the request we build but never that S3 accepts
 * it. Everything here runs against the configured bucket with real credentials. Objects are written
 * under `contract-live/` and removed in `afterAll`; the delete/cleanup assertions verify that.
 *
 * Requires `CONTRACT_LIVE_PROVIDERS` to name `s3`. Behind a proxy, also `NODE_USE_ENV_PROXY=1`.
 */
const KEY_PREFIX = 'contract-live/';
const writtenKeys: string[] = [];
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function uniqueKey(label: string): string {
  const key = `${KEY_PREFIX}${label}-${Date.now()}-${Math.trunc(performance.now() * 1000)}.bin`;
  writtenKeys.push(key);
  return key;
}

describe.skipIf(!hasS3LiveCredentials())('Amazon S3 LIVE contract', () => {
  const adapter = getDefaultS3ObjectStorageAdapter();

  afterAll(async () => {
    for (const key of writtenKeys) {
      await adapter.deleteObject(key).catch(() => undefined);
    }
  });

  // ── Core object lifecycle ──────────────────────────────────────────────

  test('putObject → headObject reports the content type and length we wrote', async () => {
    const key = uniqueKey('head');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    const metadata = await adapter.headObject(key);

    expect(metadata).not.toBeNull();
    expect(metadata?.contentType).toBe('image/png');
    expect(metadata?.contentLength).toBe(PNG_MAGIC_BYTES.byteLength);
  });

  test('getObject returns the exact bytes that were written', async () => {
    const key = uniqueKey('get');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    const fetched = await adapter.getObject(key);

    expect(fetched.contentType).toBe('image/png');
    expect(Buffer.compare(fetched.body, PNG_MAGIC_BYTES)).toBe(0);
  });

  test('headObject returns null for a key that does not exist', async () => {
    expect(await adapter.headObject(`${KEY_PREFIX}absent-${Date.now()}.bin`)).toBeNull();
  });

  test('headObjectResult reports not_found rather than throwing', async () => {
    // The confirm path branches on this: `not_found` is terminal, `transient_error` is retryable.
    // Conflating them would mark a valid upload FAILED during an S3 blip.
    const result = await adapter.headObjectResult(`${KEY_PREFIX}absent-${Date.now()}.bin`);
    expect(result.kind).toBe('not_found');
  });

  test('deleteObject removes the object and a second delete stays idempotent', async () => {
    const key = uniqueKey('delete');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    expect(await adapter.deleteObject(key)).toBe(true);
    expect(await adapter.headObject(key)).toBeNull();
    // S3 DELETE is idempotent; the adapter must not turn the second call into an error.
    await expect(adapter.deleteObject(key)).resolves.not.toThrow();
  });

  // ── Presigned upload (PUT) ─────────────────────────────────────────────

  test('a presigned upload URL is accepted by S3 for a real PUT', async () => {
    const key = uniqueKey('presign-put');
    const url = await adapter.createPresignedUploadUrl({
      key,
      contentType: 'image/png',
      contentLength: PNG_MAGIC_BYTES.byteLength,
      expiresInSeconds: 300,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(PNG_MAGIC_BYTES.byteLength),
        // sec-r4-E1 binds SSE into the signed-headers set, so a client that omits this cannot
        // upload through the URL at all — see the companion test below.
        'x-amz-server-side-encryption': 'AES256',
      },
      body: PNG_MAGIC_BYTES,
    });

    expect(response.status).toBe(200);
    // The signature is only meaningful if the bytes actually landed.
    const stored = await adapter.getObject(key);
    expect(Buffer.compare(stored.body, PNG_MAGIC_BYTES)).toBe(0);
  });

  test('a presigned upload URL is rejected when the encryption header is stripped', async () => {
    // sec-r4-E1: SSE is in the signable-headers set precisely so a misconfigured bucket cannot
    // accept an unencrypted upload through this URL. Dropping the header must break the signature.
    const key = uniqueKey('presign-put-no-sse');
    const url = await adapter.createPresignedUploadUrl({
      key,
      contentType: 'image/png',
      contentLength: PNG_MAGIC_BYTES.byteLength,
      expiresInSeconds: 300,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_MAGIC_BYTES,
    });

    expect(response.status).toBe(403);
  });

  test('a presigned upload URL is rejected when the signed content type is changed', async () => {
    const key = uniqueKey('presign-put-mismatch');
    const url = await adapter.createPresignedUploadUrl({
      key,
      contentType: 'image/png',
      contentLength: PNG_MAGIC_BYTES.byteLength,
      expiresInSeconds: 300,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-amz-server-side-encryption': 'AES256',
      },
      body: PNG_MAGIC_BYTES,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // ── Presigned upload (POST policy) ─────────────────────────────────────

  test('createPresignedUploadPost returns a policy form S3 accepts', async () => {
    const key = uniqueKey('presign-post');
    const post = await adapter.createPresignedUploadPost({
      key,
      contentType: 'image/png',
      minContentLength: 1,
      maxContentLength: 1024,
      expiresInSeconds: 300,
    });

    expect(post.url).toContain('amazonaws.com');
    expect(post.fields).toMatchObject({ key, 'Content-Type': 'image/png' });
    expect(Object.keys(post.fields)).toEqual(
      expect.arrayContaining(['Policy', 'X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Date']),
    );

    const form = new FormData();
    for (const [field, value] of Object.entries(post.fields)) form.append(field, String(value));
    form.append('file', new Blob([PNG_MAGIC_BYTES], { type: 'image/png' }));

    const response = await fetch(post.url, { method: 'POST', body: form });
    expect([200, 204]).toContain(response.status);
    expect(await adapter.headObject(key)).not.toBeNull();
  });

  test('a presigned POST is rejected when the upload exceeds the signed size ceiling', async () => {
    const key = uniqueKey('presign-post-toobig');
    const post = await adapter.createPresignedUploadPost({
      key,
      contentType: 'image/png',
      minContentLength: 1,
      maxContentLength: 4,
      expiresInSeconds: 300,
    });

    const form = new FormData();
    for (const [field, value] of Object.entries(post.fields)) form.append(field, String(value));
    // 8 bytes against a 4-byte ceiling — the policy, not our code, must refuse this.
    form.append('file', new Blob([PNG_MAGIC_BYTES], { type: 'image/png' }));

    const response = await fetch(post.url, { method: 'POST', body: form });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // ── Presigned download ─────────────────────────────────────────────────

  test('a presigned download URL returns the stored bytes', async () => {
    const key = uniqueKey('presign-get');
    await adapter.putObject({ key, body: JPEG_MAGIC_BYTES, contentType: 'image/jpeg' });

    const url = await adapter.createPresignedDownloadUrl({ key, expiresInSeconds: 300 });
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), JPEG_MAGIC_BYTES)).toBe(0);
  });

  test('a presigned download URL is rejected once expired', async () => {
    const key = uniqueKey('presign-get-expired');
    await adapter.putObject({ key, body: JPEG_MAGIC_BYTES, contentType: 'image/jpeg' });

    // SigV4 encodes the expiry in the signature, so a 1-second URL is genuinely dead after it
    // elapses — no clock manipulation needed.
    const url = await adapter.createPresignedDownloadUrl({ key, expiresInSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const response = await fetch(url);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // ── Upload verification (the confirm path) ─────────────────────────────

  test('verifyUploadedObject accepts an object matching the declared type and size', async () => {
    const key = uniqueKey('verify-ok');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    const metadata = await adapter.verifyUploadedObject(key, {
      contentType: 'image/png',
      contentLength: PNG_MAGIC_BYTES.byteLength,
    });

    expect(metadata.contentType).toBe('image/png');
    expect(metadata.contentLength).toBe(PNG_MAGIC_BYTES.byteLength);
  });

  test('verifyUploadedObject rejects a size that does not match what was declared', async () => {
    const key = uniqueKey('verify-size');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    await expect(
      adapter.verifyUploadedObject(key, { contentType: 'image/png', contentLength: 999_999 }),
    ).rejects.toThrow();
  });

  test('verifyUploadedObject rejects a content type that does not match what was declared', async () => {
    const key = uniqueKey('verify-type');
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    await expect(
      adapter.verifyUploadedObject(key, {
        contentType: 'application/pdf',
        contentLength: PNG_MAGIC_BYTES.byteLength,
      }),
    ).rejects.toThrow();
  });

  test('verifyUploadedObject rejects an object that was never uploaded', async () => {
    await expect(
      adapter.verifyUploadedObject(`${KEY_PREFIX}never-${Date.now()}.bin`, {
        contentType: 'image/png',
        contentLength: 8,
      }),
    ).rejects.toThrow();
  });

  // ── Magic-byte sniffing + TOCTOU-guarded copy ──────────────────────────

  test('getObjectFirstBytes returns only the requested prefix, with an ETag', async () => {
    const key = uniqueKey('first-bytes');
    const payload = Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(512, 0x41)]);
    await adapter.putObject({ key, body: payload, contentType: 'image/png' });

    const head = await adapter.getObjectFirstBytes(key, PNG_MAGIC_BYTES.byteLength);

    expect(head).not.toBeNull();
    // A ranged GET, not a full download — that is the point of the magic-byte check.
    expect(head?.body.byteLength).toBe(PNG_MAGIC_BYTES.byteLength);
    expect(Buffer.compare(head?.body ?? Buffer.alloc(0), PNG_MAGIC_BYTES)).toBe(0);
    expect(typeof head?.eTag).toBe('string');
  });

  test('copyObject duplicates the object to the servable key', async () => {
    const sourceKey = uniqueKey('copy-src');
    const destinationKey = uniqueKey('copy-dst');
    await adapter.putObject({ key: sourceKey, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    await adapter.copyObject({ sourceKey, destinationKey, contentType: 'image/png' });

    const copied = await adapter.getObject(destinationKey);
    expect(Buffer.compare(copied.body, PNG_MAGIC_BYTES)).toBe(0);
  });

  test('copyObject with a stale ETag fails the precondition (TOCTOU guard)', async () => {
    const sourceKey = uniqueKey('copy-toctou-src');
    const destinationKey = uniqueKey('copy-toctou-dst');
    await adapter.putObject({ key: sourceKey, body: PNG_MAGIC_BYTES, contentType: 'image/png' });
    const inspected = await adapter.getObjectFirstBytes(sourceKey, 8);
    const sourceETag = inspected?.eTag;
    if (sourceETag === undefined) throw new Error('expected an ETag from getObjectFirstBytes');

    // Replace the source after inspection — exactly the window a replayed presigned PUT opens.
    await adapter.putObject({ key: sourceKey, body: JPEG_MAGIC_BYTES, contentType: 'image/png' });

    await expect(
      adapter.copyObject({ sourceKey, destinationKey, contentType: 'image/png', sourceETag }),
    ).rejects.toThrow();
  });
});

describe.skipIf(hasS3LiveCredentials())('Amazon S3 LIVE contract — skipped', () => {
  test('reports why it did not run', () => {
    expect(describeSkipReason('s3')).toContain('s3');
  });
});
