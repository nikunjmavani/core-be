import { afterEach, beforeEach } from 'vitest';

import { resetChaosTestingListeningProxyFailuresQuietlyDuringTeardownHooks } from '@/tests/chaos/helpers/toxiproxy.client.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';

beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  await resetChaosTestingListeningProxyFailuresQuietlyDuringTeardownHooks();
});
