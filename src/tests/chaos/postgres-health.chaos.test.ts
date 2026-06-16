import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { CHAOS_POSTGRES_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import { createListeningChaosTestApplicationHarness } from '@/tests/chaos/helpers/chaos-app.js';

describe('Chaos resilience: Postgres outage on readiness probing', () => {
  let chaosListeningFastifyApplicationListeningForHealthIsolation: FastifyInstance;

  beforeAll(async () => {
    const harnessObservationAwaitingReadinessIsolation =
      await createListeningChaosTestApplicationHarness();
    chaosListeningFastifyApplicationListeningForHealthIsolation =
      harnessObservationAwaitingReadinessIsolation.chaosApplicationListeningInstance;
  });

  afterAll(async () => {
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
    // The test administratively disables the Postgres proxy, which can leave the postgres.js
    // pool holding a severed connection. Probe once (best-effort) so the pool re-establishes a
    // live connection now that the proxy is re-enabled, then bound `app.close()` so a stuck
    // `sql.end()` drain can never hang teardown up to the hook timeout. The forked worker exits
    // immediately afterward, so the OS reclaims any lingering socket.
    await chaosListeningFastifyApplicationListeningForHealthIsolation
      .inject({ method: 'GET', url: '/readyz' })
      .catch(() => undefined);
    const gracefulCloseAwaitingPoolDrain =
      chaosListeningFastifyApplicationListeningForHealthIsolation.close().catch(() => undefined);
    await Promise.race([
      gracefulCloseAwaitingPoolDrain,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 15_000);
      }),
    ]);
  }, 30_000);

  it('returns health failure while Postgres is partitioned', async () => {
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_POSTGRES_PROXY_NAME,
      async () => {
        const healthResponseAwaitingIsolation =
          await chaosListeningFastifyApplicationListeningForHealthIsolation.inject({
            method: 'GET',
            url: '/readyz',
          });

        expect(healthResponseAwaitingIsolation.statusCode).toBe(503);
      },
    );
  });
});
