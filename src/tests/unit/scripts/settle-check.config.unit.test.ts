import { describe, expect, it } from 'vitest';
import { parsePositiveIntegerEnv, resolveQueueNames } from '@/scripts/ops/settle-check.config.js';

describe('parsePositiveIntegerEnv', () => {
  it('returns the fallback when the value is absent', () => {
    expect(parsePositiveIntegerEnv(undefined, 120_000)).toBe(120_000);
  });

  it('parses a valid positive integer', () => {
    expect(parsePositiveIntegerEnv('30000', 120_000)).toBe(30_000);
  });

  it('falls back on a non-numeric value', () => {
    expect(parsePositiveIntegerEnv('soon', 2_000)).toBe(2_000);
  });

  it('falls back on zero and negative values', () => {
    expect(parsePositiveIntegerEnv('0', 2_000)).toBe(2_000);
    expect(parsePositiveIntegerEnv('-5', 2_000)).toBe(2_000);
  });

  it('parses the leading integer of a mixed value', () => {
    expect(parsePositiveIntegerEnv('15s', 2_000)).toBe(15);
  });
});

describe('resolveQueueNames', () => {
  const defaults = ['mail', 'webhook-delivery', 'notification', 'stripe-webhook'] as const;

  it('returns a copy of the defaults when no override is set', () => {
    const resolved = resolveQueueNames(undefined, defaults);
    expect(resolved).toEqual([...defaults]);
    expect(resolved).not.toBe(defaults);
  });

  it('falls back to defaults for a blank or whitespace override', () => {
    expect(resolveQueueNames('', defaults)).toEqual([...defaults]);
    expect(resolveQueueNames('   ', defaults)).toEqual([...defaults]);
  });

  it('parses a comma-separated override, trimming blanks', () => {
    expect(resolveQueueNames('mail, notification ,, webhook-delivery', defaults)).toEqual([
      'mail',
      'notification',
      'webhook-delivery',
    ]);
  });

  it('falls back to defaults when every override entry is blank', () => {
    expect(resolveQueueNames(', ,', defaults)).toEqual([...defaults]);
  });
});
