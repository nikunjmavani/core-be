import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';

import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { CircuitBreaker } from '@/infrastructure/resilience/circuit-breaker.js';

const MAX_REDIS_COMMANDS_PER_FAILED_EXECUTE = 8;
const PARALLEL_FAILURE_COUNT = 100;

function createRedisCommandCounter(redis: Redis): { getCount: () => number } {
  let commandCount = 0;
  const originalSendCommand = redis.sendCommand.bind(redis);
  redis.sendCommand = (...args: Parameters<Redis['sendCommand']>) => {
    commandCount += 1;
    return originalSendCommand(...args);
  };
  return { getCount: () => commandCount };
}

describe('Chaos resilience: circuit breaker Redis contention', () => {
  const circuitName = `chaos-contention-${randomUUID()}`;
  const countingRedis = redisConnection.duplicate();
  const commandCounter = createRedisCommandCounter(countingRedis);
  const circuit = new CircuitBreaker({
    name: circuitName,
    redis: countingRedis,
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
  });

  afterAll(async () => {
    try {
      await circuit.reset();
      await countingRedis.del(`circuit:${circuitName}`);
    } catch {
      /* Best-effort teardown when Redis reconnects slower than Vitest teardown. */
    }
    countingRedis.disconnect();
  });

  it('bounds Redis commands under parallel failures and converges to OPEN', async () => {
    await circuit.reset();
    const baselineCommands = commandCounter.getCount();

    const parallelResults = await Promise.allSettled(
      Array.from({ length: PARALLEL_FAILURE_COUNT }, () =>
        circuit.execute(async () => Promise.reject(new Error('chaos_parallel_failure'))),
      ),
    );

    const rejectedCount = parallelResults.filter((result) => result.status === 'rejected').length;
    expect(rejectedCount).toBe(PARALLEL_FAILURE_COUNT);

    const commandsDuringBurst = commandCounter.getCount() - baselineCommands;
    const maxExpectedCommands = PARALLEL_FAILURE_COUNT * MAX_REDIS_COMMANDS_PER_FAILED_EXECUTE;
    expect(commandsDuringBurst).toBeLessThan(maxExpectedCommands);

    expect(await circuit.getState()).toBe('OPEN');

    await expect(circuit.execute(async () => Promise.resolve('should_not_run'))).rejects.toThrow(
      /Circuit breaker .* is OPEN/,
    );
  });
});
