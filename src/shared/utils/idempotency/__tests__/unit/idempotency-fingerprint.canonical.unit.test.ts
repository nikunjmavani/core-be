import { describe, it, expect } from 'vitest';
import { buildIdempotencyRequestFingerprint } from '@/shared/utils/idempotency/idempotency-fingerprint.util.js';

/**
 * Regression for sec-M6 (Low): the legacy fingerprint used `JSON.stringify`,
 * which silently strips `undefined` keys and preserves key insertion order.
 * Two structurally distinct bodies (`{a:1, b:undefined}` vs `{a:1}`, or
 * `{a:1, b:2}` vs `{b:2, a:1}`) could collide on one fingerprint, letting
 * the second body replay against the cached response of the first under the
 * same idempotency key.
 *
 * The canonical serializer sorts keys and replaces `undefined` with an
 * explicit marker, so any structural difference produces a distinct hash.
 */
describe('buildIdempotencyRequestFingerprint — canonical serialization (sec-M6)', () => {
  const baseInput = { method: 'POST', routePath: '/api/v1/something' };

  it('distinguishes a body with explicit undefined value from one without that key', () => {
    const withUndefined = buildIdempotencyRequestFingerprint({
      ...baseInput,
      body: { a: 1, b: undefined },
    });
    const withoutKey = buildIdempotencyRequestFingerprint({ ...baseInput, body: { a: 1 } });
    expect(withUndefined).not.toBe(withoutKey);
  });

  it('does NOT distinguish bodies that differ only in key order (canonical sort)', () => {
    const ab = buildIdempotencyRequestFingerprint({ ...baseInput, body: { a: 1, b: 2 } });
    const ba = buildIdempotencyRequestFingerprint({ ...baseInput, body: { b: 2, a: 1 } });
    expect(ab).toBe(ba);
  });

  it('preserves array element order', () => {
    const ascending = buildIdempotencyRequestFingerprint({
      ...baseInput,
      body: { items: [1, 2, 3] },
    });
    const descending = buildIdempotencyRequestFingerprint({
      ...baseInput,
      body: { items: [3, 2, 1] },
    });
    expect(ascending).not.toBe(descending);
  });

  it('distinguishes nested-object undefined-key presence at any depth', () => {
    const nestedWithUndefined = buildIdempotencyRequestFingerprint({
      ...baseInput,
      body: { outer: { a: 1, b: undefined } },
    });
    const nestedWithoutKey = buildIdempotencyRequestFingerprint({
      ...baseInput,
      body: { outer: { a: 1 } },
    });
    expect(nestedWithUndefined).not.toBe(nestedWithoutKey);
  });
});
