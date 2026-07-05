import { afterEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
  LOG_LEVEL: 'silent',
  TRUST_PROXY_REQUIRED: false as boolean,
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
    envState.TRUST_PROXY_REQUIRED = false;
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('throws when TRUST_PROXY_REQUIRED and TRUST_PROXY resolves to false/unset', async () => {
    envState.TRUST_PROXY_REQUIRED = true;
    envState.TRUST_PROXY = false;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).toThrow(/trust_proxy\.hosted_unset/);
  });

  it('does not throw when TRUST_PROXY_REQUIRED and a positive hop count is set', async () => {
    envState.TRUST_PROXY_REQUIRED = true;
    envState.TRUST_PROXY = 1;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).not.toThrow();
  });

  it('does not throw when TRUST_PROXY_REQUIRED is false even with TRUST_PROXY unset', async () => {
    envState.TRUST_PROXY_REQUIRED = false;
    envState.TRUST_PROXY = false;
    const assertHostedTrustProxyConfigured = await loadAssertion();
    expect(() => assertHostedTrustProxyConfigured()).not.toThrow();
  });
});
