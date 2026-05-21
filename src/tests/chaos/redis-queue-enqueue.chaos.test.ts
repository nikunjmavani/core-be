import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FastifyInstance } from 'fastify';

import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { CHAOS_REDIS_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import { createListeningChaosTestApplicationHarness } from '@/tests/chaos/helpers/chaos-app.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

async function waitForMailDispatchFailureLog(spy: ReturnType<typeof vi.spyOn>): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const observedFailureLog = spy.mock.calls.some((call: unknown[]) => {
      const messageAwaitingEnqueueFailureObservation = call[1];
      return (
        messageAwaitingEnqueueFailureObservation === 'mail.enqueue.failed' ||
        messageAwaitingEnqueueFailureObservation === 'event-bus.on-commit.task.failed'
      );
    });
    if (observedFailureLog) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  return false;
}

describe('Chaos resilience: Redis outage while enqueueing transactional email work', () => {
  let chaosListeningFastifyApplication: FastifyInstance;

  beforeAll(async () => {
    const harnessForEnqueueObservationAwaitingIsolation =
      await createListeningChaosTestApplicationHarness();
    chaosListeningFastifyApplication =
      harnessForEnqueueObservationAwaitingIsolation.chaosApplicationListeningInstance;
  });

  afterAll(async () => {
    await chaosListeningFastifyApplication.close();
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });

  it('surfaces user-visible successes while post-commit mail dispatch logs durable failures gracefully', async () => {
    const mailEnqueueObservationSpyListening = vi.spyOn(logger, 'error');

    const userSendingOutboundMagicLinks = await createTestUser({
      email: `chaos-magic-link-enqueue-${randomUUID()}@example.com`,
    });

    try {
      await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
        CHAOS_REDIS_PROXY_NAME,
        async () => {
          const magicLinkResponseAwaitingObservation =
            await chaosListeningFastifyApplication.inject({
              method: 'POST',
              url: testApiPath('/auth/magic-link/send'),
              payload: JSON.stringify({ email: userSendingOutboundMagicLinks.email }),
              headers: {
                'content-type': 'application/json',
              },
            });

          expect(magicLinkResponseAwaitingObservation.statusCode).toBe(200);
          await expect(
            waitForMailDispatchFailureLog(mailEnqueueObservationSpyListening),
          ).resolves.toBe(true);
        },
      );
    } finally {
      mailEnqueueObservationSpyListening.mockRestore();
    }
  });
});
