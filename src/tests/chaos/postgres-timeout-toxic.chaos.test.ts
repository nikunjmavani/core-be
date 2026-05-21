import { describe, expect, it } from 'vitest';

import { sql } from '@/infrastructure/database/connection.js';
import { CHAOS_POSTGRES_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  withTemporaryListeningProxyToxinForChaosAssertion,
} from '@/tests/chaos/helpers/toxiproxy.client.js';

describe('Chaos resilience: Postgres premature connection timeout toxin', () => {
  it('surfaces Postgres driver rejects while toxin is armed and heals immediately afterward', async () => {
    await withTemporaryListeningProxyToxinForChaosAssertion(
      CHAOS_POSTGRES_PROXY_NAME,
      {
        name: 'postgres_upstream_timeout_observer',
        type: 'timeout',
        stream: 'upstream',
        toxicity: 1,
        attributes: {
          timeout: 1,
        },
      },
      async () => {
        await expect(sql`SELECT 1`).rejects.toThrow();
      },
    );

    await expect(sql`SELECT 1`).resolves.not.toThrow();
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });
});
