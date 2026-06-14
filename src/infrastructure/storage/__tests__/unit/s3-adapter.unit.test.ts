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
  class CopyObjectCommand {
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
    CopyObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...arguments_: unknown[]) => getSignedUrlMock(...arguments_),
}));

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'eu-west-1',
    S3_MAX_ATTEMPTS: 3,
    LOG_LEVEL: 'silent',
    // audit-#13: unset → getObjectUrl falls back to the virtual-hosted S3 URL.
    PUBLIC_MEDIA_BASE_URL: undefined as string | undefined,
  },
}));
vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
  // audit-#13: buildPublicMediaUrl reads PUBLIC_MEDIA_BASE_URL via getEnv() (re-read-friendly).
  getEnv: () => mockEnv,
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

  it('createPresignedUploadUrl returns a signed PUT URL bound to an exact Content-Length', async () => {
    const url = await adapter.createPresignedUploadUrl({
      key: 'uploads/file.png',
      contentType: 'image/png',
      contentLength: 1024,
      expiresInSeconds: 900,
    });

    expect(url).toBe('https://signed.example/put');
    expect(getSignedUrlMock).toHaveBeenCalledOnce();

    const [, command, signingOptions] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      { input: { ContentLength?: number } },
      { signableHeaders?: Set<string> },
    ];
    // The signed command binds Content-Length so S3 rejects an oversized body.
    expect(command.input.ContentLength).toBe(1024);
    expect(signingOptions.signableHeaders).toBeInstanceOf(Set);
    expect([...(signingOptions.signableHeaders ?? [])]).toContain('content-length');
  });

  // sec-U11: server-side writes (worker putObject, copyObject) must request
  // SSE-S3 (`AES256`) on every command so a misconfigured bucket (no default
  // SSE) cannot silently land plaintext audit / data-export bundles in S3.
  // The bucket policy is a defence in depth — not the only protection.
  it('putObject sets ServerSideEncryption: AES256 on the underlying PutObjectCommand (sec-U11)', async () => {
    sendMock.mockResolvedValueOnce({});

    await adapter.putObject({
      key: 'audit/export.ndjson.gz',
      body: Buffer.from('test'),
      contentType: 'application/x-ndjson',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const [putCommand] = sendMock.mock.calls[0] as [{ input: { ServerSideEncryption?: string } }];
    expect(putCommand.input.ServerSideEncryption).toBe('AES256');
  });

  it('copyObject sets ServerSideEncryption: AES256 on the underlying CopyObjectCommand (sec-U11)', async () => {
    sendMock.mockResolvedValueOnce({});

    await adapter.copyObject({
      sourceKey: 'pending/avatars/u1.png',
      destinationKey: 'avatars/u1.png',
      contentType: 'image/png',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const [copyCommand] = sendMock.mock.calls[0] as [{ input: { ServerSideEncryption?: string } }];
    expect(copyCommand.input.ServerSideEncryption).toBe('AES256');
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

  it('copyObject issues a server-side copy that replaces the content-type', async () => {
    sendMock.mockResolvedValueOnce({});

    await adapter.copyObject({
      sourceKey: 'pending/avatars/u/x.png',
      destinationKey: 'avatars/u/x.png',
      contentType: 'image/png',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      CopySource: 'test-bucket/pending/avatars/u/x.png',
      Key: 'avatars/u/x.png',
      ContentType: 'image/png',
      MetadataDirective: 'REPLACE',
    });
  });
});
