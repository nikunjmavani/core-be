import '@/shared/config/load-env-files.js';

import process from 'node:process';

import { waitProvisionAndGloballyClearChaosProxyListeners } from '@/tests/chaos/helpers/toxiproxy.client.js';

waitProvisionAndGloballyClearChaosProxyListeners().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
