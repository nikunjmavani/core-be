import nock from 'nock';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { isContractFixtureRecordingEnabled } from './contract-mode.js';
import { resetOutboundServiceCircuitBreakerState } from './circuit-reset.js';

let outboundContractIsolationHooksWereRegisteredOnce = false;

/**
 * Guards outbound sockets during contract runs and resets circuit breaker + nock mocks between specs.
 *
 * Subsequent imports are no-ops so every contract file can explicitly opt in once while Vitest attaches a single hook instance.
 */
export function registerThirdPartyContractTestIsolationHooks(): void {
  if (outboundContractIsolationHooksWereRegisteredOnce) {
    return;
  }
  outboundContractIsolationHooksWereRegisteredOnce = true;

  beforeAll(() => {
    if (!nock.isActive()) {
      nock.activate();
    }
    if (!isContractFixtureRecordingEnabled()) {
      nock.disableNetConnect();
    }
  });

  beforeEach(async () => {
    await resetOutboundServiceCircuitBreakerState();
    nock.cleanAll();
    if (!isContractFixtureRecordingEnabled()) {
      nock.disableNetConnect();
    }
  });

  afterAll(() => {
    nock.cleanAll();
    nock.restore();
    nock.enableNetConnect();
  });
}
