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

  it('returns readiness failure while Postgres is partitioned yet keeps pure liveness positive', async () => {
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_POSTGRES_PROXY_NAME,
      async () => {
        const readinessResponseAwaitingIsolation =
          await chaosListeningFastifyApplicationListeningForHealthIsolation.inject({
            method: 'GET',
            url: '/health/ready',
          });

        expect(readinessResponseAwaitingIsolation.statusCode).toBe(503);

        const livenessObservationResponseAwaitingIsolation =
          await chaosListeningFastifyApplicationListeningForHealthIsolation.inject({
            method: 'GET',
            url: '/health/live',
          });

        expect(livenessObservationResponseAwaitingIsolation.statusCode).toBe(200);
      },
    );
  });
});
