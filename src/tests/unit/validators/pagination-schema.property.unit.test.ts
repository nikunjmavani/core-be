import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { PAGINATION } from '@/shared/constants/index.js';
import { paginationSchema } from '@/shared/utils/http/pagination.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

describe('paginationSchema (property)', () => {
  it('accepts in-range page and limit integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: PAGINATION.MAX_LIMIT }),
        (page, limit) => {
          const parsed = paginationSchema.safeParse({ page, limit });
          expect(parsed.success).toBe(true);
          if (parsed.success) {
            expect(parsed.data.page).toBe(page);
            expect(parsed.data.limit).toBe(limit);
          }
        },
      ),
      propertyOptions,
    );
  });

  it('rejects limit above MAX_LIMIT', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: PAGINATION.MAX_LIMIT + 1, max: PAGINATION.MAX_LIMIT + 500 }),
        (page, limit) => {
          expect(paginationSchema.safeParse({ page, limit }).success).toBe(false);
        },
      ),
      propertyOptions,
    );
  });
});
