import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const getSignedUrlMock = vi.fn().mockResolvedValue('https://signed.example/put');

vi.mock('@/infrastructure/resilience/circuit-breaker.js', () => ({
  s3Circuit: {
    execute: <T>(operation: () => Promise<T>) => operation(),
  },
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class HeadObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: vi.fn(function S3ClientMock() {
      return { send: sendMock };
    }),
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...arguments_: unknown[]) => getSignedUrlMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'eu-west-1',
    S3_MAX_ATTEMPTS: 3,
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { S3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';

describe('S3ObjectStorageAdapter', () => {
  let adapter: S3ObjectStorageAdapter;

  beforeEach(() => {
    adapter = new S3ObjectStorageAdapter();
    sendMock.mockReset();
    getSignedUrlMock.mockClear();
    getSignedUrlMock.mockResolvedValue('https://signed.example/put');
  });

  it('getObjectUrl builds a regional virtual-hosted-style URL', () => {
    expect(adapter.getObjectUrl('avatars/user-1/avatar.png')).toBe(
      'https://test-bucket.s3.eu-west-1.amazonaws.com/avatars/user-1/avatar.png',
    );
  });

  it('createPresignedDownloadUrl returns a signed GET URL', async () => {
    getSignedUrlMock.mockResolvedValueOnce('https://signed.example/get');
    const url = await adapter.createPresignedDownloadUrl({
      key: 'user-data-export/user/exp.json.gz',
      expiresInSeconds: 86_400,
    });
    expect(url).toBe('https://signed.example/get');
    expect(getSignedUrlMock).toHaveBeenCalled();
  });

  it('createPresignedUploadUrl returns a signed PUT URL', async () => {
    const url = await adapter.createPresignedUploadUrl({
      key: 'uploads/file.png',
      contentType: 'image/png',
      contentLength: 1024,
      expiresInSeconds: 900,
    });

    expect(url).toBe('https://signed.example/put');
    expect(getSignedUrlMock).toHaveBeenCalledOnce();
  });

  it('headObject maps S3 metadata to port shape', async () => {
    sendMock.mockResolvedValueOnce({
      ContentType: 'image/png',
      ContentLength: 2048,
    });

    const metadata = await adapter.headObject('uploads/file.png');

    expect(metadata).toEqual({ contentType: 'image/png', contentLength: 2048 });
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('deleteObject returns false when S3 delete fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('access denied'));

    const deleted = await adapter.deleteObject('uploads/missing.png');

    expect(deleted).toBe(false);
  });
});
