import { describe, expect, it } from 'vitest';
import { isPaddleEnvelope } from '@/shared/middlewares/response-format.middleware.js';

describe('isPaddleEnvelope', () => {
  it('returns false for non-objects and null', () => {
    expect(isPaddleEnvelope(null)).toBe(false);
    expect(isPaddleEnvelope(undefined)).toBe(false);
    expect(isPaddleEnvelope('string')).toBe(false);
    expect(isPaddleEnvelope(42)).toBe(false);
  });

  it('returns false when data or meta keys are missing', () => {
    expect(isPaddleEnvelope({})).toBe(false);
    expect(isPaddleEnvelope({ data: {} })).toBe(false);
    expect(isPaddleEnvelope({ meta: { request_id: 'req_1' } })).toBe(false);
  });

  it('returns false when meta is null, not an object, or request_id is not a string', () => {
    expect(isPaddleEnvelope({ data: {}, meta: null })).toBe(false);
    expect(isPaddleEnvelope({ data: {}, meta: 'meta' })).toBe(false);
    expect(isPaddleEnvelope({ data: {}, meta: { request_id: 1 } })).toBe(false);
  });

  it('returns true for valid Paddle-style envelopes', () => {
    expect(
      isPaddleEnvelope({
        data: { id: 'sub_1' },
        meta: { request_id: 'req_1' },
      }),
    ).toBe(true);
  });
});
