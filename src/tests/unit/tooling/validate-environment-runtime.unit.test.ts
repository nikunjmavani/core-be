import { describe, expect, it } from 'vitest';
import {
  findMissingKeys,
  resolveEnvironmentLabel,
} from '@tooling/setup/github/validate-environment-runtime.js';

describe('findMissingKeys', () => {
  it('treats an unset key as missing', () => {
    expect(findMissingKeys({}, ['DATABASE_URL'])).toEqual(['DATABASE_URL']);
  });

  it('treats an empty or whitespace-only value as missing', () => {
    // The reason this tool exists rather than a plain `key in process.env` check:
    // an empty GitHub Environment secret reaches the runner as '', which would
    // pass a presence check and then crash-loop the container at Zod boot.
    expect(findMissingKeys({ DATABASE_URL: '' }, ['DATABASE_URL'])).toEqual(['DATABASE_URL']);
    expect(findMissingKeys({ DATABASE_URL: '   ' }, ['DATABASE_URL'])).toEqual(['DATABASE_URL']);
  });

  it('accepts a present, non-empty value', () => {
    expect(findMissingKeys({ DATABASE_URL: 'postgres://x' }, ['DATABASE_URL'])).toEqual([]);
  });

  it('does not trim the value it accepts — padding is a real value, not emptiness', () => {
    expect(findMissingKeys({ REDIS_URL: ' redis://x ' }, ['REDIS_URL'])).toEqual([]);
  });

  it('reports every missing key, preserving the caller order', () => {
    expect(findMissingKeys({ B: 'set' }, ['A', 'B', 'C'])).toEqual(['A', 'C']);
  });

  it('returns nothing when there are no keys to check', () => {
    expect(findMissingKeys({}, [])).toEqual([]);
  });
});

describe('resolveEnvironmentLabel', () => {
  it('prefers CONFIG over ENVIRONMENT', () => {
    expect(resolveEnvironmentLabel({ CONFIG: 'production', ENVIRONMENT: 'development' })).toBe(
      'production',
    );
  });

  it('falls back to ENVIRONMENT, then to a placeholder', () => {
    expect(resolveEnvironmentLabel({ ENVIRONMENT: 'development' })).toBe('development');
    expect(resolveEnvironmentLabel({})).toBe('unknown');
  });
});
