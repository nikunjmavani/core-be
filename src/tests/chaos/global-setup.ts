import { waitProvisionAndGloballyClearChaosProxyListeners } from '@/tests/chaos/helpers/toxiproxy.client.js';

/**
 * Provision Toxiproxy routes before forks import database/redis singletons pointing at proxies.
 */
export default async function globalSetupForVitestChaosSuite(): Promise<void> {
  await waitProvisionAndGloballyClearChaosProxyListeners();
}
