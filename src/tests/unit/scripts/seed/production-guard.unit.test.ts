import { describe, expect, it } from 'vitest';
import { assertBulkSeedAllowed } from '@/scripts/seed/production-guard.js';

const LOCAL_URL = 'postgresql://user:pass@localhost:5432/core';
const HOSTED_URL = 'postgresql://user:pass@ep-aged.neon.tech:5432/neondb';

describe('assertBulkSeedAllowed', () => {
  it('allows a local DATABASE_URL in development', () => {
    expect(() =>
      assertBulkSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: LOCAL_URL }),
    ).not.toThrow();
  });

  it('allows a production NODE_ENV when DATABASE_URL is local (safety is host-based, not NODE_ENV)', () => {
    expect(() =>
      assertBulkSeedAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL_URL }),
    ).not.toThrow();
  });

  it('refuses a non-local DATABASE_URL host', () => {
    expect(() =>
      assertBulkSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: HOSTED_URL }),
    ).toThrow(/not local/);
  });

  it('refuses when DATABASE_URL is missing', () => {
    expect(() => assertBulkSeedAllowed({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('lets ALLOW_BULK_SEED=1 override every check', () => {
    expect(() =>
      assertBulkSeedAllowed({
        ALLOW_BULK_SEED: '1',
        NODE_ENV: 'production',
        DATABASE_URL: HOSTED_URL,
      }),
    ).not.toThrow();
  });
});
