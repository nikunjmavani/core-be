import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { buildIdempotencyCacheKey } from '@/shared/utils/idempotency/idempotency-key.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

const segmentArbitrary = fc
  .array(fc.constantFrom('a', 'b', '1', '-', '_'), { minLength: 1, maxLength: 32 })
  .map((characters) => characters.join(''));

describe('buildIdempotencyCacheKey (property)', () => {
  it('always namespaces by organization and user segments', () => {
    fc.assert(
      fc.property(
        segmentArbitrary,
        segmentArbitrary,
        segmentArbitrary,
        (key, userId, organizationId) => {
          const cacheKey = buildIdempotencyCacheKey(key, { userId, organizationId });
          expect(cacheKey).toBe(`idempotency:${organizationId}:${userId}:none:${key}`);
        },
      ),
      propertyOptions,
    );
  });

  it('uses anonymous and none placeholders when scope is omitted', () => {
    fc.assert(
      fc.property(segmentArbitrary, (key) => {
        expect(buildIdempotencyCacheKey(key, {})).toBe(`idempotency:none:anonymous:none:${key}`);
      }),
      propertyOptions,
    );
  });
});
