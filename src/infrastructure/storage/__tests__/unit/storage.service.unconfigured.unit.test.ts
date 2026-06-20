import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@/shared/errors/index.js';

/**
 * EX-28: when S3_BUCKET is not configured, storage operations throw a classified ConfigurationError
 * (a 500 config fault) rather than a generic Error — so an unconfigured bucket surfaces clearly
 * instead of as an opaque server error.
 */

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function S3ClientMock() {
    return { send: vi.fn() };
  }),
  PutObjectCommand: class {},
  HeadObjectCommand: class {},
  DeleteObjectCommand: class {},
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/put'),
}));

// S3_BUCKET intentionally undefined; S3_REGION set so getS3Client() itself does not throw first.
vi.mock('@/shared/config/env.config.js', () => ({
  env: { S3_BUCKET: undefined, S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 },
  getEnv: () => ({ S3_BUCKET: undefined, S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 }),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createPresignedUploadUrl,
  headObject,
  putObjectBuffer,
} from '@/infrastructure/storage/storage.service.js';

describe('storage.service — S3_BUCKET unconfigured (EX-28)', () => {
  it('createPresignedUploadUrl throws ConfigurationError', async () => {
    await expect(
      createPresignedUploadUrl({ key: 'k', contentType: 'image/png', expiresInSeconds: 60 }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('headObject throws ConfigurationError', async () => {
    await expect(headObject('k')).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('putObjectBuffer throws ConfigurationError', async () => {
    await expect(
      putObjectBuffer({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});
