import { afterAll, describe, expect, it } from 'vitest';

import { stripeCircuit } from '@/infrastructure/resilience/circuit-breaker.js';
import { CHAOS_REDIS_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import { withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion } from '@/tests/chaos/helpers/toxiproxy.client.js';

describe('Chaos resilience: Redis outage for Stripe circuit breaker', () => {
  afterAll(async () => {
    try {
      await stripeCircuit.reset();
    } catch {
      /* Best-effort teardown when Redis briefly reconnects slower than Vitest teardown ordering. */
    }
  });

  it('maintains deterministic OPEN pacing using local snapshots while Redis lookups fail outright', async () => {
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_REDIS_PROXY_NAME,
      async () => {
        await stripeCircuit.reset();

        for (let failureAttemptIndex = 0; failureAttemptIndex < 5; failureAttemptIndex += 1) {
          await expect(
            stripeCircuit.execute(async () =>
              Promise.reject(new Error(`chaos_fixture_failure_attempt_${failureAttemptIndex}`)),
            ),
          ).rejects.toThrow();
        }

        await expect(
          stripeCircuit.execute(async () => Promise.resolve('unexpected_success')),
        ).rejects.toThrow(/Circuit breaker .* is OPEN/);
      },
    );
  });
});
