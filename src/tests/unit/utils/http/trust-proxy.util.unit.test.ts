import { afterEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test' as string,
  RAILWAY_GIT_COMMIT_SHA: undefined as string | undefined,
  TRUST_PROXY: false as boolean | number | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  get env() {
    return envState;
  },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

async function loadAssertion() {
  vi.resetModules();
  const module = await import('@/shared/utils/http/trust-proxy.util.js');
  return module.assertHostedTrustProxyConfigured;
}

describe('assertHostedTrustProxyConfigured', () => {
  afterEach(() => {
    envState.NODE_ENV = 'test';
    envState.RAILWAY_GIT_COMMIT_SHA = undefined;
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('throws in a hosted deployment when TRUST_PROXY resolves to false/unset', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = false;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).toThrow(/trust_proxy\.hosted_unset/);
  });

  it('throws on a hosted Railway deployment (RAILWAY_GIT_COMMIT_SHA set) with TRUST_PROXY unset', async () => {
    envState.NODE_ENV = 'development';
    envState.RAILWAY_GIT_COMMIT_SHA = 'deadbeef';
    envState.TRUST_PROXY = false;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).toThrow(/trust_proxy\.hosted_unset/);
  });

  it('does not throw in a hosted deployment with a positive hop count', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = 1;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).not.toThrow();
  });

  it('does not throw on local/test even when TRUST_PROXY is false', async () => {
    envState.NODE_ENV = 'test';
    envState.TRUST_PROXY = false;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).not.toThrow();
  });
});
