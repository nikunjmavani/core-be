import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  addToxinOntoListeningChaosTestingProxyDefinition,
  removeEveryToxinAttachedToListeningChaosTestingProxyDefinition,
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  setChaosTestingListeningProxyEnabledAdministrativeSwitch,
  withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { CHAOS_REDIS_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import { createListeningChaosTestApplicationHarness } from '@/tests/chaos/helpers/chaos-app.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Chaos resilience: Redis idempotency', () => {
  let chaosFastifyApplicationInstance: FastifyInstance;

  beforeAll(async () => {
    const harness = await createListeningChaosTestApplicationHarness();
    chaosFastifyApplicationInstance = harness.chaosApplicationListeningInstance;
  });

  afterAll(async () => {
    await chaosFastifyApplicationInstance.close();
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });

  function uniqueSlugForChaosIsolation(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }

  function uniqueIdempotencyKeyForChaosScenario(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  it('serves replayed payloads when Redis recovers despite artificial latency overhead', async () => {
    const userWaitingForIsolation = await createTestUser();
    const authenticationTokenWaitingForIsolation = await generateTestToken({
      userId: userWaitingForIsolation.public_id,
    });
    const idempotencyKeyWaitingForIsolation = uniqueIdempotencyKeyForChaosScenario('replay');
    const firstSlugAwaitingIsolation = uniqueSlugForChaosIsolation('replay-first');

    const firstHttpResponseAwaitingIsolation = await chaosFastifyApplicationInstance.inject({
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      headers: {
        authorization: `Bearer ${authenticationTokenWaitingForIsolation}`,
        'x-idempotency-key': idempotencyKeyWaitingForIsolation,
        'content-type': 'application/json',
      },
      payload: { name: 'Replay Organization', slug: firstSlugAwaitingIsolation },
    });

    expect(firstHttpResponseAwaitingIsolation.statusCode).toBeLessThan(500);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    await removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(CHAOS_REDIS_PROXY_NAME);
    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(CHAOS_REDIS_PROXY_NAME, true);
    await addToxinOntoListeningChaosTestingProxyDefinition(CHAOS_REDIS_PROXY_NAME, {
      name: 'redis_listen_latency_upstream',
      type: 'latency',
      stream: 'upstream',
      toxicity: 1,
      attributes: {
        latency: 2000,
      },
    });

    try {
      const secondHttpResponseAwaitingIsolation = await chaosFastifyApplicationInstance.inject({
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        headers: {
          authorization: `Bearer ${authenticationTokenWaitingForIsolation}`,
          'x-idempotency-key': idempotencyKeyWaitingForIsolation,
          'content-type': 'application/json',
        },
        payload: { name: 'Replay Organization', slug: firstSlugAwaitingIsolation },
      });

      expect(secondHttpResponseAwaitingIsolation.statusCode).toBeLessThan(500);
      expect(secondHttpResponseAwaitingIsolation.headers['x-idempotency-replay']).toBe('true');
    } finally {
      await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
    }
  });

  it('fails closed when Redis is partitioned while issuing an X-Idempotency-Key', async () => {
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_REDIS_PROXY_NAME,
      async () => {
        const userWaitingForIsolation = await createTestUser();
        const authenticationTokenWaitingForIsolation = await generateTestToken({
          userId: userWaitingForIsolation.public_id,
        });
        const slugWaitingForIsolation = uniqueSlugForChaosIsolation('redis-down-org');

        const httpResponseAwaitingIsolation = await chaosFastifyApplicationInstance.inject({
          method: 'POST',
          url: testApiPath('/tenancy/organizations'),
          headers: {
            authorization: `Bearer ${authenticationTokenWaitingForIsolation}`,
            'x-idempotency-key': uniqueIdempotencyKeyForChaosScenario('redis-downidem'),
            'content-type': 'application/json',
          },
          payload: { name: 'Chaos Postgres Organization', slug: slugWaitingForIsolation },
        });

        expect(httpResponseAwaitingIsolation.statusCode).toBe(503);
        const body = JSON.parse(httpResponseAwaitingIsolation.body) as {
          error?: { code?: string };
        };
        expect(body.error?.code).toBe('service_unavailable');
      },
    );
  });
});
