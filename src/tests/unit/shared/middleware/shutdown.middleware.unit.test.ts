import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  LOG_LEVEL: 'silent',
  SHUTDOWN_TIMEOUT_MS: undefined as number | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
}));

vi.mock('@/infrastructure/database/connection.js', () => ({
  closeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/cache/bullmq-redis.client.js', () => ({
  closeBullMqRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  closeMailQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/notify/sub-domains/notification/queues/notification.queue.js', () => ({
  closeNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js', () => ({
  closeWebhookDeliveryQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  flushSentry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

/** Watchdog adds a 5s buffer over SHUTDOWN_TIMEOUT_MS so the inner DB drain completes first. */
const SHUTDOWN_WATCHDOG_BUFFER_MS = 5_000;
/** Default shutdown timeout when SHUTDOWN_TIMEOUT_MS env is unset. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

import shutdownMiddleware from '@/shared/middlewares/shutdown.middleware.js';

describe('shutdown.middleware', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockEnv.SHUTDOWN_TIMEOUT_MS = undefined;
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
  });

  async function waitUntilProcessExitIsCalled(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (processExitSpy.mock.calls.length === 0) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for process.exit');
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  it('schedules shutdown watchdog at default DEFAULT_SHUTDOWN_TIMEOUT_MS + buffer when SHUTDOWN_TIMEOUT_MS is unset', async () => {
    const originalSetTimeout = global.setTimeout;
    const scheduledDelaysListeningForShutdownTimeout: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation(((handler, timeout, ...arguments_) => {
      if (typeof timeout === 'number') {
        scheduledDelaysListeningForShutdownTimeout.push(timeout);
      }
      return originalSetTimeout(handler, timeout, ...arguments_);
    }) as typeof setTimeout);

    const applicationListeningForShutdown = Fastify({ logger: false });
    await applicationListeningForShutdown.register(shutdownMiddleware);
    await applicationListeningForShutdown.ready();

    process.emit('SIGTERM');
    await waitUntilProcessExitIsCalled();

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(scheduledDelaysListeningForShutdownTimeout).toContain(
      DEFAULT_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_WATCHDOG_BUFFER_MS,
    );
  });

  it('schedules shutdown watchdog at SHUTDOWN_TIMEOUT_MS + buffer when set', async () => {
    mockEnv.SHUTDOWN_TIMEOUT_MS = 5_000;

    const originalSetTimeout = global.setTimeout;
    const scheduledDelaysListeningForShutdownTimeout: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation(((handler, timeout, ...arguments_) => {
      if (typeof timeout === 'number') {
        scheduledDelaysListeningForShutdownTimeout.push(timeout);
      }
      return originalSetTimeout(handler, timeout, ...arguments_);
    }) as typeof setTimeout);

    const applicationListeningForShutdown = Fastify({ logger: false });
    await applicationListeningForShutdown.register(shutdownMiddleware);
    await applicationListeningForShutdown.ready();

    process.emit('SIGTERM');
    await waitUntilProcessExitIsCalled();

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(scheduledDelaysListeningForShutdownTimeout).toContain(
      5_000 + SHUTDOWN_WATCHDOG_BUFFER_MS,
    );
  });

  it('calls process.exit(1) when app.close exceeds SHUTDOWN_TIMEOUT_MS + buffer', async () => {
    mockEnv.SHUTDOWN_TIMEOUT_MS = 20;

    const applicationListeningForShutdown = Fastify({ logger: false });
    await applicationListeningForShutdown.register(shutdownMiddleware);
    applicationListeningForShutdown.addHook('onClose', () => new Promise<void>(() => {}));
    await applicationListeningForShutdown.ready();

    process.emit('SIGTERM');

    /** Watchdog is now 20 + 5_000 = 5_020 ms; allow extra slack so the spy observes the exit(1). */
    const deadline = Date.now() + 10_000;
    while (!processExitSpy.mock.calls.some((call: readonly unknown[]) => call[0] === 1)) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for process.exit(1)');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }

    expect(processExitSpy).toHaveBeenCalledWith(1);
  } /** Watchdog (5_020 ms) plus slack must comfortably exceed Vitest's default 5_000 ms timeout. */, 15_000);
});
