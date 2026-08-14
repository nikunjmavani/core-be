import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `registerAuthEventHandlers` is the auth domain's event-handler aggregator. Its TSDoc claims it
 * is "idempotent — safe to call from multiple bootstraps", and a module-level `registered` flag
 * implements that claim, but nothing called it twice. Double registration would subscribe the
 * auth-method handlers a second time on the shared event bus — and every verification-code and
 * password-reset email would be enqueued (and sent) twice per request.
 */

const registerAuthMethodEventHandlersMock = vi.fn();

vi.mock('@/domains/auth/sub-domains/auth-method/events/auth.event-handlers.js', () => ({
  registerAuthMethodEventHandlers: (...parameters: unknown[]) =>
    registerAuthMethodEventHandlersMock(...parameters),
}));

/** Re-imports the aggregator with a fresh module registry so its `registered` flag starts false. */
async function importFreshAggregator() {
  vi.resetModules();
  return import('@/domains/auth/events/auth.event-handlers.js');
}

describe('registerAuthEventHandlers', () => {
  beforeEach(() => {
    registerAuthMethodEventHandlersMock.mockReset();
  });

  it('wires the auth-method handlers on the first call', async () => {
    const { registerAuthEventHandlers } = await importFreshAggregator();
    registerAuthEventHandlers();
    expect(registerAuthMethodEventHandlersMock).toHaveBeenCalledOnce();
  });

  it('is idempotent — repeated bootstraps never re-subscribe the handlers', async () => {
    const { registerAuthEventHandlers } = await importFreshAggregator();
    // `buildApp()` registers handlers before routes, and the test harness builds several apps in
    // one process; without the guard each build would add another subscriber to the same bus.
    registerAuthEventHandlers();
    registerAuthEventHandlers();
    registerAuthEventHandlers();
    expect(registerAuthMethodEventHandlersMock).toHaveBeenCalledOnce();
  });
});
