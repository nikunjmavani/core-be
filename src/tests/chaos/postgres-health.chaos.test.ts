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
    await chaosListeningFastifyApplicationListeningForHealthIsolation.close();
  }, 120_000);

  it('returns health failure while Postgres is partitioned', async () => {
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_POSTGRES_PROXY_NAME,
      async () => {
        const healthResponseAwaitingIsolation =
          await chaosListeningFastifyApplicationListeningForHealthIsolation.inject({
            method: 'GET',
            url: '/health',
          });

        expect(healthResponseAwaitingIsolation.statusCode).toBe(503);
      },
    );
  });
});
