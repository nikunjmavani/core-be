import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    S3_REGION: undefined as string | undefined,
    S3_MAX_ATTEMPTS: 3,
    S3_ACCESS_KEY_ID: undefined as string | undefined,
    S3_SECRET_ACCESS_KEY: undefined as string | undefined,
    S3_ENDPOINT: undefined as string | undefined,
    S3_FORCE_PATH_STYLE: false,
  },
}));

vi.mock('@/shared/config/env.config.js', () => ({ env: mockEnv, getEnv: () => mockEnv }));

const { buildSharedS3ClientConfig } = await import(
  '@/infrastructure/storage/s3-client-config.util.js'
);

describe('buildSharedS3ClientConfig', () => {
  beforeEach(() => {
    mockEnv.S3_REGION = undefined;
    mockEnv.S3_MAX_ATTEMPTS = 3;
    mockEnv.S3_ACCESS_KEY_ID = undefined;
    mockEnv.S3_SECRET_ACCESS_KEY = undefined;
    mockEnv.S3_ENDPOINT = undefined;
    mockEnv.S3_FORCE_PATH_STYLE = false;
  });

  it('defaults region to us-east-1 and carries the retry budget', () => {
    const config = buildSharedS3ClientConfig();
    expect(config.region).toBe('us-east-1');
    expect(config.maxAttempts).toBe(3);
  });

  it('omits endpoint/forcePathStyle when S3_ENDPOINT is unset (AWS default)', () => {
    const config = buildSharedS3ClientConfig();
    expect(config).not.toHaveProperty('endpoint');
    expect(config).not.toHaveProperty('forcePathStyle');
  });

  it('threads endpoint + forcePathStyle when S3_ENDPOINT is set (MinIO / R2 / LocalStack)', () => {
    mockEnv.S3_ENDPOINT = 'http://localhost:9000';
    mockEnv.S3_FORCE_PATH_STYLE = true;
    const config = buildSharedS3ClientConfig();
    expect(config.endpoint).toBe('http://localhost:9000');
    expect(config.forcePathStyle).toBe(true);
  });

  it('includes static credentials only when both key id and secret are present', () => {
    expect(buildSharedS3ClientConfig().credentials).toBeUndefined();

    mockEnv.S3_ACCESS_KEY_ID = 'local-test-key';
    mockEnv.S3_SECRET_ACCESS_KEY = 'local-test-secret';
    expect(buildSharedS3ClientConfig().credentials).toEqual({
      accessKeyId: 'local-test-key',
      secretAccessKey: 'local-test-secret',
    });
  });
});
