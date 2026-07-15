import { describe, expect, it } from 'vitest';
import { addMonths } from '@/domains/billing/sub-domains/subscription/subscription-period.util.js';

/** Local-time Date (month is 0-indexed) so assertions match the util's local getters/setters. */
function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe('addMonths', () => {
  it('clamps Jan 31 + 1 month to Feb 28 in a non-leap year (no month-end overflow)', () => {
    const result = addMonths(localDate(2027, 0, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2027, 1, 28]);
  });

  it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
    const result = addMonths(localDate(2028, 0, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2028, 1, 29]);
  });

  it('clamps Mar 31 + 1 month to Apr 30 (30-day target month)', () => {
    const result = addMonths(localDate(2027, 2, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2027, 3, 30]);
  });

  it('preserves the day when the target month has enough days', () => {
    const result = addMonths(localDate(2027, 0, 15), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2027, 1, 15]);
  });

  it('rolls the year over for a December start', () => {
    const result = addMonths(localDate(2027, 11, 31), 1);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2028, 0, 31]);
  });

  it('clamps Feb 29 + 12 months to Feb 28 of the following (non-leap) year', () => {
    const result = addMonths(localDate(2028, 1, 29), 12);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2029, 1, 28]);
  });

  it('does not mutate the input date', () => {
    const base = localDate(2027, 0, 31);
    addMonths(base, 1);
    expect([base.getFullYear(), base.getMonth(), base.getDate()]).toEqual([2027, 0, 31]);
  });
});
