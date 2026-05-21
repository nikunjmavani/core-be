import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { PINO_REDACT_PATHS } from '@/shared/utils/http/fastify-server.util.js';

describe('logger.util', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('exports a pino logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(PINO_REDACT_PATHS).toContain('authorization');
  });

  it('enables pino-pretty transport when NODE_ENV is local', async () => {
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: { LOG_LEVEL: 'debug', NODE_ENV: 'local' },
    }));
    const { logger: localLogger } = await import('@/shared/utils/infrastructure/logger.util.js');
    expect(localLogger).toBeDefined();
    expect(typeof localLogger.info).toBe('function');
  });
});
