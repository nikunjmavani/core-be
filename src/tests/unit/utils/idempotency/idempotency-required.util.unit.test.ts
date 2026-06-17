import { describe, it, expect } from 'vitest';
import { UnprocessableEntityError } from '@/shared/errors/index.js';
import { assertIdempotencyKeyPresentWhenRequired } from '@/shared/utils/idempotency/idempotency-required.util.js';

describe('idempotency required util', () => {
  it('throws 422 when route requires idempotency key and header is absent', () => {
    const request = {
      method: 'POST',
      routeOptions: { config: { idempotencyRequired: true } },
      headers: {},
    };

    expect(() => assertIdempotencyKeyPresentWhenRequired(request as never)).toThrow(
      UnprocessableEntityError,
    );
  });

  it('does not throw when idempotency key is present on a required route', () => {
    const request = {
      method: 'POST',
      routeOptions: { config: { idempotencyRequired: true } },
      headers: { 'x-idempotency-key': 'test-key-1234567890' },
    };

    expect(() => assertIdempotencyKeyPresentWhenRequired(request as never)).not.toThrow();
  });
});
