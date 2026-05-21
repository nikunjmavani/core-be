import { describe, expect, it } from 'vitest';
import {
  assertMagicLinkEnvironmentSafe,
  isLocalFrontendHostname,
} from '@/shared/config/magic-link-env-guard.util.js';

describe('magic-link-env-guard', () => {
  it('isLocalFrontendHostname accepts localhost and 127.0.0.1', () => {
    expect(isLocalFrontendHostname('http://localhost:3000')).toBe(true);
    expect(isLocalFrontendHostname('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalFrontendHostname('https://staging.example.com')).toBe(false);
  });

  it('assertMagicLinkEnvironmentSafe allows production with any FRONTEND_URL', () => {
    expect(() =>
      assertMagicLinkEnvironmentSafe({
        nodeEnv: 'production',
        frontendUrl: 'https://app.example.com',
      }),
    ).not.toThrow();
  });

  it('assertMagicLinkEnvironmentSafe allows development with localhost FRONTEND_URL', () => {
    expect(() =>
      assertMagicLinkEnvironmentSafe({
        nodeEnv: 'development',
        frontendUrl: 'http://localhost:3000',
      }),
    ).not.toThrow();
  });

  it('assertMagicLinkEnvironmentSafe rejects NODE_ENV=staging', () => {
    expect(() =>
      assertMagicLinkEnvironmentSafe({
        nodeEnv: 'staging',
        frontendUrl: 'http://localhost:3000',
      }),
    ).toThrow(/NODE_ENV="staging" is not allowed/);
  });

  it('assertMagicLinkEnvironmentSafe rejects non-local FRONTEND_URL when not production', () => {
    expect(() =>
      assertMagicLinkEnvironmentSafe({
        nodeEnv: 'development',
        frontendUrl: 'https://staging.example.com',
      }),
    ).toThrow(/FRONTEND_URL must use localhost or 127\.0\.0\.1/);
  });
});
