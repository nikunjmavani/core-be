import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObservedRouteResponse } from '@/app.js';
import { ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME } from '@tooling/route-coverage/constants.js';

let flushCounter = 0;

/**
 * Collects `"METHOD /route/pattern statusCode"` observations reported by
 * `buildApp({ observeResponses })` and flushes them to a unique file under
 * `route-coverage-observed/` when the test app closes.
 */
export type RouteStatusObserver = {
  /** Callback for {@link import('@/app.js').BuildAppOptions.observeResponses}. */
  observeResponse: (observation: ObservedRouteResponse) => void;
  /** Writes collected observations to disk (no-op when nothing was observed). */
  flush: () => void;
};

/**
 * Creates the passive route-status observer used by `createTestApp()`.
 *
 * `pnpm validate:route-success-coverage` consumes the flushed lines after a
 * full test run to (a) fail when an observed 2xx/3xx contradicts the declared
 * status in `route-success-statuses.json` and (b) ratchet the number of
 * catalog routes whose declared happy path was never observed.
 *
 * One file per app instance (pid + counter) keeps concurrent vitest lanes
 * from interleaving writes; the validator deduplicates across files.
 */
export function createRouteStatusObserver(): RouteStatusObserver {
  const observed = new Set<string>();

  return {
    observeResponse: (observation) => {
      observed.add(`${observation.method} ${observation.routeUrl} ${observation.statusCode}`);
    },
    flush: () => {
      if (observed.size === 0) {
        return;
      }
      const observedDirectory = join(process.cwd(), ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME);
      mkdirSync(observedDirectory, { recursive: true });
      flushCounter += 1;
      const observedFile = join(observedDirectory, `observed-${process.pid}-${flushCounter}.txt`);
      writeFileSync(observedFile, `${[...observed].sort().join('\n')}\n`);
      observed.clear();
    },
  };
}
