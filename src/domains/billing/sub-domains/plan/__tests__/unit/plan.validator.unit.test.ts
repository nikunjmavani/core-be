import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateGetPlanParams } from '@/domains/billing/sub-domains/plan/plan.validator.js';

/**
 * `validateGetPlanParams` was the only validator in the billing domain with no unit test, and
 * it is the boundary of a **public** route (`GET /billing/plans/:plan_id` needs no auth). The
 * path param flows straight into a repository lookup and into observability labels, so the
 * strict/length refusals below are the only thing standing between an anonymous caller and
 * unbounded attacker-supplied input reaching those sinks.
 */
describe('plan.validator', () => {
  it('accepts a well-formed plan_id and returns the trimmed value', () => {
    expect(validateGetPlanParams({ plan_id: 'pln_a1b2c3d4e5f6g7h8i9j0k' })).toEqual({
      plan_id: 'pln_a1b2c3d4e5f6g7h8i9j0k',
    });
  });

  it('rejects a missing plan_id param', () => {
    expect(() => validateGetPlanParams({})).toThrow(ValidationError);
  });

  it('rejects a non-string plan_id', () => {
    expect(() => validateGetPlanParams({ plan_id: 42 })).toThrow(ValidationError);
  });

  it('rejects an empty (or whitespace-only) plan_id', () => {
    // `trimmedStringMinMax(1, 28)` trims first, so a whitespace-only param collapses to '' and
    // fails the min(1) bound rather than reaching the repository as a blank lookup key.
    expect(() => validateGetPlanParams({ plan_id: '' })).toThrow(ValidationError);
    expect(() => validateGetPlanParams({ plan_id: '   ' })).toThrow(ValidationError);
  });

  it('rejects an over-long plan_id (public ids are 28 chars at most)', () => {
    expect(() => validateGetPlanParams({ plan_id: 'p'.repeat(29) })).toThrow(ValidationError);
  });

  it('rejects unknown keys (the DTO is .strict())', () => {
    expect(() =>
      validateGetPlanParams({ plan_id: 'pln_a1b2c3d4e5f6g7h8i9j0k', organization_id: 'org_x' }),
    ).toThrow(ValidationError);
  });

  it('surfaces the failing field name in the ValidationError details', () => {
    // The error handler expands `details` into the Paddle-style `errors[]` list, so the
    // snake_case field name is part of the public API contract, not an internal detail.
    try {
      validateGetPlanParams({});
      expect.unreachable('expected validateGetPlanParams to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).details ?? {})).toContain('plan_id');
    }
  });
});
