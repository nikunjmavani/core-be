import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSignedUrlMock = vi.fn().mockResolvedValue('https://signed.example/put');

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
  return {
    S3Client: vi.fn(function S3ClientMock() {
      return { send: vi.fn() };
    }),
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...arguments_: unknown[]) => getSignedUrlMock(...arguments_),
}));

vi.mock('@/infrastructure/outbound/index.js', () => ({
  outboundCall: vi.fn(),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { S3_BUCKET: 'test-bucket', S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 },
  getEnv: () => ({ S3_BUCKET: 'test-bucket', S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 }),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createPresignedUploadUrl } from '@/infrastructure/storage/storage.service.js';

describe('storage.service createPresignedUploadUrl', () => {
  beforeEach(() => {
    getSignedUrlMock.mockClear();
    getSignedUrlMock.mockResolvedValue('https://signed.example/put');
  });

  it('binds Content-Length and signs it when maxContentLength is provided', async () => {
    await createPresignedUploadUrl({
      key: 'uploads/file.pdf',
      contentType: 'application/pdf',
      expiresInSeconds: 900,
      maxContentLength: 4096,
    });

    const [, command, signingOptions] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      { input: { ContentLength?: number } },
      { signableHeaders?: Set<string> },
    ];
    expect(command.input.ContentLength).toBe(4096);
    expect([...(signingOptions.signableHeaders ?? [])]).toContain('content-length');
  });

  it('omits the Content-Length constraint when maxContentLength is not provided', async () => {
    await createPresignedUploadUrl({
      key: 'uploads/file.pdf',
      contentType: 'application/pdf',
      expiresInSeconds: 900,
    });

    const [, command, signingOptions] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      { input: { ContentLength?: number } },
      { signableHeaders?: Set<string> },
    ];
    expect(command.input.ContentLength).toBeUndefined();
    expect(signingOptions.signableHeaders).toBeUndefined();
  });
});
