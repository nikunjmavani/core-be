import { afterAll, describe, expect, test } from 'vitest';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { hasS3LiveCredentials, describeSkipReason } from './helpers/live-credentials.js';

/**
 * Live S3 contract — exercises the real put → head → get → delete cycle through the same
 * adapter the application uses, so a permissions, region, or SDK-behaviour change surfaces
 * here rather than in production.
 *
 * Requires an explicit `CONTRACT_LIVE_S3_ALLOW_WRITES=true` because it writes objects. Point
 * `S3_BUCKET` at a throwaway bucket, or `S3_ENDPOINT` at MinIO / LocalStack. Every key it
 * writes is prefixed `contract-live/` and deleted in `afterAll`.
 */
const KEY_PREFIX = 'contract-live/';
const writtenKeys: string[] = [];
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe.skipIf(!hasS3LiveCredentials())('Amazon S3 LIVE contract', () => {
  const adapter = getDefaultS3ObjectStorageAdapter();

  afterAll(async () => {
    for (const key of writtenKeys) {
      await adapter.deleteObject(key).catch(() => undefined);
    }
  });

  test('putObject → headObject reports the content type and length we wrote', async () => {
    const key = `${KEY_PREFIX}head-${Date.now()}.png`;
    writtenKeys.push(key);

    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });
    const metadata = await adapter.headObject(key);

    expect(metadata).not.toBeNull();
    expect(metadata?.contentType).toBe('image/png');
    expect(metadata?.contentLength).toBe(PNG_MAGIC_BYTES.byteLength);
  });

  test('getObject returns the exact bytes that were written', async () => {
    const key = `${KEY_PREFIX}get-${Date.now()}.png`;
    writtenKeys.push(key);

    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });
    const fetched = await adapter.getObject(key);

    expect(fetched.contentType).toBe('image/png');
    expect(Buffer.compare(fetched.body, PNG_MAGIC_BYTES)).toBe(0);
  });

  test('headObject returns null for a key that does not exist', async () => {
    const metadata = await adapter.headObject(`${KEY_PREFIX}absent-${Date.now()}.png`);
    expect(metadata).toBeNull();
  });

  test('deleteObject removes the object and a subsequent head returns null', async () => {
    const key = `${KEY_PREFIX}delete-${Date.now()}.png`;
    await adapter.putObject({ key, body: PNG_MAGIC_BYTES, contentType: 'image/png' });

    expect(await adapter.deleteObject(key)).toBe(true);
    expect(await adapter.headObject(key)).toBeNull();
  });

  test('createPresignedUploadUrl signs against the configured bucket', async () => {
    const key = `${KEY_PREFIX}presign-${Date.now()}.png`;
    const url = await adapter.createPresignedUploadUrl({
      key,
      contentType: 'image/png',
      contentLength: PNG_MAGIC_BYTES.byteLength,
      expiresInSeconds: 300,
    });

    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain(encodeURIComponent(key).replace(/%2F/g, '/'));
  });
});

describe.skipIf(hasS3LiveCredentials())('Amazon S3 LIVE contract — skipped', () => {
  test('reports why it did not run', () => {
    expect(describeSkipReason('s3')).toContain('s3');
  });
});
