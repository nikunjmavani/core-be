import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sec-U11: server-side writes (audit cold export, GDPR data-export NDJSON,
 * mail-outbox attachments) must request SSE-S3 (`AES256`) on every
 * `PutObjectCommand` so a bucket whose default encryption is misconfigured
 * cannot silently land plaintext PII / audit history in S3. The bucket
 * default encryption is defence in depth — the explicit per-command setting
 * is the primary boundary.
 */

const sendMock = vi.fn();

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
      return { send: sendMock };
    }),
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/put'),
}));

vi.mock('@/infrastructure/outbound/index.js', () => ({
  outboundCall: async (options: { operation: (signal: AbortSignal) => Promise<unknown> }) => {
    await options.operation(new AbortController().signal);
  },
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { S3_BUCKET: 'test-bucket', S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 },
  getEnv: () => ({ S3_BUCKET: 'test-bucket', S3_REGION: 'eu-west-1', S3_MAX_ATTEMPTS: 3 }),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { putObjectBuffer } from '@/infrastructure/storage/storage.service.js';

describe('storage.service putObjectBuffer (sec-U11)', () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({});
  });

  it('sets ServerSideEncryption: AES256 on the PutObjectCommand', async () => {
    await putObjectBuffer({
      key: 'audit/2026/05/org_abc.ndjson.gz',
      body: Buffer.from('test'),
      contentType: 'application/x-ndjson',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const [putCommand] = sendMock.mock.calls[0] as [{ input: { ServerSideEncryption?: string } }];
    expect(putCommand.input.ServerSideEncryption).toBe('AES256');
  });

  it('preserves caller metadata while still requesting SSE-S3', async () => {
    await putObjectBuffer({
      key: 'user-data-export/u_alice.json.gz',
      body: Buffer.from('test'),
      contentType: 'application/json',
      metadata: { 'export-id': 'exp_alice' },
    });

    const [putCommand] = sendMock.mock.calls[0] as [
      {
        input: {
          ServerSideEncryption?: string;
          Metadata?: Record<string, string>;
        };
      },
    ];
    expect(putCommand.input.ServerSideEncryption).toBe('AES256');
    // Metadata must round-trip — SSE is in addition to, not in place of, caller fields.
    expect(putCommand.input.Metadata).toEqual({ 'export-id': 'exp_alice' });
  });
});
