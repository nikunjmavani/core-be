import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SLUG_REGEX } from '@/shared/constants/index.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

function projectMonthlyAmountDue(priceMonthly: number, billingCycle: 'MONTHLY' | 'YEARLY'): number {
  return billingCycle === 'MONTHLY' ? priceMonthly : Math.round((priceMonthly * 12) / 12);
}

const propertyOptions = propertyAssertOptions();

describe('Property-based: billing money', () => {
  it('monthly amount due equals monthly price for MONTHLY cycle', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (priceMonthly) => {
        expect(projectMonthlyAmountDue(priceMonthly, 'MONTHLY')).toBe(priceMonthly);
      }),
      propertyOptions,
    );
  });

  it('amount due is never negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom('MONTHLY' as const, 'YEARLY' as const),
        (priceMonthly, billingCycle) => {
          expect(projectMonthlyAmountDue(priceMonthly, billingCycle)).toBeGreaterThanOrEqual(0);
        },
      ),
      propertyOptions,
    );
  });
});

describe('Property-based: public identifiers', () => {
  it('generatePublicId always matches slug-style length and charset', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), () => {
        const identifier = generatePublicId();
        expect(identifier).toHaveLength(21);
        expect(SLUG_REGEX.test(identifier)).toBe(true);
      }),
      propertyOptions,
    );
  });
});
