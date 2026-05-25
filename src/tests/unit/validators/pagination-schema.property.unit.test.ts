import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { PAGINATION } from '@/shared/constants/index.js';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

describe('cursorPaginationSchema (property)', () => {
  it('accepts in-range limit integers with optional after cursor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: PAGINATION.MAX_LIMIT }),
        fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: undefined }),
        (limit, after) => {
          const parsed = cursorPaginationSchema.safeParse({ limit, ...(after ? { after } : {}) });
          expect(parsed.success).toBe(true);
          if (parsed.success) {
            expect(parsed.data.limit).toBe(limit);
            expect(parsed.data.after).toBe(after);
          }
        },
      ),
      propertyOptions,
    );
  });

  it('rejects limit above MAX_LIMIT', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PAGINATION.MAX_LIMIT + 1, max: PAGINATION.MAX_LIMIT + 500 }),
        (limit) => {
          expect(cursorPaginationSchema.safeParse({ limit }).success).toBe(false);
        },
      ),
      propertyOptions,
    );
  });
});
