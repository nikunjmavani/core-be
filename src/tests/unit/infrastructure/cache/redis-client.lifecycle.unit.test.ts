import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RedisConstructorCall {
  url: unknown;
  options: Record<string, unknown>;
}

const redisConstructorCalls: RedisConstructorCall[] = [];

class MockRedis extends EventEmitter {
  status: 'wait' | 'connecting' | 'connect' | 'ready' | 'end' = 'wait';

  connect = vi.fn<() => Promise<void>>();

  quit = vi.fn<() => Promise<'OK'>>().mockResolvedValue('OK');

  constructor(url: unknown, options: Record<string, unknown> = {}) {
    super();
    redisConstructorCalls.push({ url, options });
    /** Default behaviour mirrors `lazyConnect: true` — created but not yet connected. */
    this.status = 'wait';
    this.connect.mockImplementation(async () => {
      this.status = 'ready';
    });
  }
}

vi.mock('ioredis', () => ({
  Redis: MockRedis,
  default: MockRedis,
}));

async function importRedisClient() {
  return import('@/infrastructure/cache/redis.client.js');
}

describe('redis client lifecycle (mocked ioredis)', () => {
  beforeEach(() => {
    redisConstructorCalls.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connectRedis calls connect() when status is wait', async () => {
    const { redisConnection, connectRedis } = await importRedisClient();
    const mockClient = redisConnection as unknown as MockRedis;
    mockClient.status = 'wait';

    await connectRedis();

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.status).toBe('ready');
  });

  it('connectRedis is a no-op when already connected', async () => {
    const { redisConnection, connectRedis } = await importRedisClient();
    const mockClient = redisConnection as unknown as MockRedis;
    mockClient.status = 'ready';

    await connectRedis();

    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it('connectRedis rejects on connection error', async () => {
    const { redisConnection, connectRedis } = await importRedisClient();
    const mockClient = redisConnection as unknown as MockRedis;
    mockClient.status = 'wait';
    mockClient.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(connectRedis()).rejects.toThrow('ECONNREFUSED');
  });

  it('redisConnection uses keyPrefix from env (defaults to core:test:)', async () => {
    await importRedisClient();

    expect(redisConstructorCalls).toHaveLength(1);
    const [{ options }] = redisConstructorCalls as [RedisConstructorCall];
    expect(options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      keyPrefix: 'core:test:',
    });
    expect(typeof options.retryStrategy).toBe('function');
  });

  it('connectRedis waits for ready when status is connecting and resolves on ready event', async () => {
    const { redisConnection, connectRedis } = await importRedisClient();
    const mockClient = redisConnection as unknown as MockRedis;
    mockClient.status = 'connecting';

    const pendingConnect = connectRedis();

    /** Emitting `ready` must resolve the wait-for-ready listener registered above. */
    setImmediate(() => mockClient.emit('ready'));
    await expect(pendingConnect).resolves.toBeUndefined();
    expect(mockClient.connect).not.toHaveBeenCalled();
  });
});
