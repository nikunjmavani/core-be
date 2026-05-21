import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { uuidSchema } from '@/shared/utils/identity/uuid.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

describe('uuidSchema (property)', () => {
  it('accepts canonical UUID strings from fast-check', () => {
    fc.assert(
      fc.property(fc.uuid(), (value) => {
        expect(uuidSchema.safeParse(value).success).toBe(true);
      }),
      propertyOptions,
    );
  });

  it('rejects strings that are not UUID-shaped', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((value) => !/^[0-9a-f-]{36}$/i.test(value)),
        (value) => {
          expect(uuidSchema.safeParse(value).success).toBe(false);
        },
      ),
      propertyOptions,
    );
  });
});
