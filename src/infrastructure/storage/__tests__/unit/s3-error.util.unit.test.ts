import { describe, it, expect } from 'vitest';
import { isS3NotFoundError } from '@/infrastructure/storage/s3-error.util.js';
import { ExternalServiceError } from '@/infrastructure/outbound/index.js';

/**
 * audit-#5: only an explicit S3 not-found may drive destructive cleanup. These tests pin the
 * boundary between "object truly absent" (true) and "transient outage" (false), including the
 * `outboundCall` wrapping that buries the AWS SDK error on `ExternalServiceError.cause`.
 */
describe('isS3NotFoundError', () => {
  it('detects raw AWS not-found signatures', () => {
    expect(isS3NotFoundError({ name: 'NotFound' })).toBe(true);
    expect(isS3NotFoundError({ name: 'NoSuchKey' })).toBe(true);
    expect(isS3NotFoundError({ Code: 'NoSuchKey' })).toBe(true);
    expect(isS3NotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it('unwraps an ExternalServiceError to find the not-found cause', () => {
    const wrapped = new ExternalServiceError({
      integration: 's3',
      category: 'unknown',
      cause: { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
    });
    expect(isS3NotFoundError(wrapped)).toBe(true);
  });

  it('returns false for transient failures (timeout / throttle / circuit-open / 5xx)', () => {
    expect(isS3NotFoundError(new Error('socket hang up'))).toBe(false);
    expect(isS3NotFoundError({ name: 'TimeoutError' })).toBe(false);
    expect(isS3NotFoundError({ $metadata: { httpStatusCode: 503 } })).toBe(false);
    expect(
      isS3NotFoundError(
        new ExternalServiceError({
          integration: 's3',
          category: 'timeout',
          cause: { name: 'TimeoutError' },
        }),
      ),
    ).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isS3NotFoundError(null)).toBe(false);
    expect(isS3NotFoundError(undefined)).toBe(false);
    expect(isS3NotFoundError('NotFound')).toBe(false);
  });
});
