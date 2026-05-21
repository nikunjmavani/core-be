import nock from 'nock';
import { vi } from 'vitest';

/**
 * Lexical `vi.mock` in a Vitest setup file runs before test modules import infrastructure
 * (Vitest does not hoist `vi.mock` from helper modules imported by tests).
 */
if (!nock.isActive()) {
  nock.activate();
}

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    status: 'ready',
    get: vi.fn(async (): Promise<string | null> => null),
    set: vi.fn(async () => 'OK'),
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    quit: vi.fn(),
  },
}));
