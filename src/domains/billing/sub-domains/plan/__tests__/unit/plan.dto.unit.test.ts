import { describe, expect, it } from 'vitest';
import { getPlanParamsDto } from '@/domains/billing/sub-domains/plan/plan.dto.js';

/**
 * The plan path param. Small surface, but it is the one caller-controlled value on a public
 * catalogue route, so the bounds are what keep an unbounded string out of the lookup.
 */
describe('plan.dto', () => {
  it('accepts a well-formed plan id', () => {
    expect(getPlanParamsDto.safeParse({ plan_id: 'pln_abcdefghijklmnopqrst' }).success).toBe(true);
  });

  it('accepts an id at exactly 28 characters', () => {
    expect(getPlanParamsDto.safeParse({ plan_id: 'p'.repeat(28) }).success).toBe(true);
  });

  it.each([
    ['an empty id', ''],
    ['a whitespace-only id', '   '],
    ['an id over 28 characters', 'p'.repeat(29)],
  ])('rejects %s', (_label, plan_id) => {
    expect(getPlanParamsDto.safeParse({ plan_id }).success).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(getPlanParamsDto.safeParse({}).success).toBe(false);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['an array', ['pln_abc']],
  ])('rejects %s as an id', (_label, plan_id) => {
    expect(getPlanParamsDto.safeParse({ plan_id }).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(getPlanParamsDto.parse({ plan_id: '  pln_abc  ' }).plan_id).toBe('pln_abc');
  });

  it('measures length AFTER trimming', () => {
    expect(getPlanParamsDto.safeParse({ plan_id: `  ${'p'.repeat(28)}  ` }).success).toBe(true);
  });

  it('rejects an extra param (.strict)', () => {
    // A plan lookup takes the plan and nothing else — no organization or price re-scoping.
    expect(
      getPlanParamsDto.safeParse({ plan_id: 'pln_abc', organization_id: 'org_other' }).success,
    ).toBe(false);
  });
});
