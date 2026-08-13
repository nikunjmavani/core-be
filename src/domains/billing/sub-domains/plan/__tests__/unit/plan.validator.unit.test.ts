import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateGetPlanParams } from '@/domains/billing/sub-domains/plan/plan.validator.js';

/**
 * `GET /api/v1/plans/:plan_id` is a public route, so this validator is the first thing an
 * unauthenticated caller reaches. It was untested — including the `.strict()` behaviour that stops
 * an unknown param from riding along, and the trim that keeps a padded id from reaching the
 * repository lookup.
 */
describe('plan.validator — validateGetPlanParams', () => {
  it('accepts a well-formed plan id', () => {
    expect(validateGetPlanParams({ plan_id: 'pln_abcdefghijklmnopqrstu' })).toEqual({
      plan_id: 'pln_abcdefghijklmnopqrstu',
    });
  });

  it('trims surrounding whitespace before the value reaches the repository', () => {
    expect(validateGetPlanParams({ plan_id: '  pln_abc  ' })).toEqual({ plan_id: 'pln_abc' });
  });

  it('accepts a single-character id (min boundary)', () => {
    expect(validateGetPlanParams({ plan_id: 'p' })).toEqual({ plan_id: 'p' });
  });

  it('accepts a 28-character id (max boundary)', () => {
    const atMax = 'p'.repeat(28);

    expect(validateGetPlanParams({ plan_id: atMax })).toEqual({ plan_id: atMax });
  });

  describe('rejections', () => {
    it.each([
      ['an empty plan_id', { plan_id: '' }],
      ['a whitespace-only plan_id', { plan_id: '   ' }],
      ['a 29-character plan_id (over max)', { plan_id: 'p'.repeat(29) }],
      ['a missing plan_id', {}],
      ['a numeric plan_id', { plan_id: 123 }],
      ['a null plan_id', { plan_id: null }],
      ['an array plan_id', { plan_id: ['a'] }],
      ['a null params object', null],
      ['an undefined params object', undefined],
    ])('throws ValidationError for %s', (_label, params) => {
      expect(() => validateGetPlanParams(params)).toThrow(ValidationError);
    });

    it('rejects an unknown extra param (.strict blocks parameter smuggling)', () => {
      expect(() =>
        validateGetPlanParams({ plan_id: 'pln_abc', organization_id: 'org_other' }),
      ).toThrow(ValidationError);
    });

    it('raises a 400 carrying the shared invalid-input translation key', () => {
      try {
        validateGetPlanParams({});
        expect.unreachable('validateGetPlanParams should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toMatchObject({ statusCode: 400, messageKey: 'errors:invalidInput' });
      }
    });

    it('reports the offending field so the client knows what to fix', () => {
      try {
        validateGetPlanParams({});
        expect.unreachable('validateGetPlanParams should have thrown');
      } catch (error) {
        const validationError = error as ValidationError;
        expect(validationError.errors?.some((item) => item.field === 'plan_id')).toBe(true);
      }
    });
  });
});
