import { afterEach, describe, expect, it, vi } from 'vitest';

describe('worker-concurrency.util', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses per-family overrides when set, otherwise WORKER_CONCURRENCY', async () => {
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        WORKER_CONCURRENCY: 4,
        WORKER_CONCURRENCY_MAIL: 2,
        WORKER_CONCURRENCY_NOTIFY: 6,
        WORKER_CONCURRENCY_WEBHOOK: 10,
        WORKER_CONCURRENCY_STRIPE: 3,
      },
    }));

    const {
      getWorkerConcurrencyMail,
      getWorkerConcurrencyNotify,
      getWorkerConcurrencyWebhook,
      getWorkerConcurrencyStripe,
    } = await import('@/shared/config/worker-concurrency.util.js');

    expect(getWorkerConcurrencyMail()).toBe(2);
    expect(getWorkerConcurrencyNotify()).toBe(6);
    expect(getWorkerConcurrencyWebhook()).toBe(10);
    expect(getWorkerConcurrencyStripe()).toBe(3);
  });

  it('falls back to WORKER_CONCURRENCY when family override is unset', async () => {
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        WORKER_CONCURRENCY: 5,
        WORKER_CONCURRENCY_MAIL: undefined,
        WORKER_CONCURRENCY_NOTIFY: undefined,
        WORKER_CONCURRENCY_WEBHOOK: undefined,
        WORKER_CONCURRENCY_STRIPE: undefined,
      },
    }));

    const {
      getWorkerConcurrencyMail,
      getWorkerConcurrencyNotify,
      getWorkerConcurrencyWebhook,
      getWorkerConcurrencyStripe,
    } = await import('@/shared/config/worker-concurrency.util.js');

    expect(getWorkerConcurrencyMail()).toBe(5);
    expect(getWorkerConcurrencyNotify()).toBe(5);
    expect(getWorkerConcurrencyWebhook()).toBe(5);
    expect(getWorkerConcurrencyStripe()).toBe(5);
  });
});
