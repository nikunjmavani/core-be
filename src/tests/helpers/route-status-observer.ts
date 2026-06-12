import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObservedRouteResponse } from '@/app.js';
import { ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME } from '@tooling/route-coverage/constants.js';

let flushCounter = 0;

/** One captured request/response body pair for a `(method, route, status)` key. */
export type CapturedRouteExample = {
  request_body?: unknown;
  response_body?: unknown;
};

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

/** True when this run should also capture request/response example bodies. */
export function isRouteExampleCaptureEnabled(): boolean {
  return process.env.ROUTE_EXAMPLE_CAPTURE === '1';
}

/**
 * Creates the passive route-status observer used by `createTestApp()`.
 *
 * `pnpm validate:route-success-coverage` consumes the flushed lines after a
 * full test run to (a) fail when an observed 2xx/3xx contradicts the declared
 * status in `route-success-statuses.json` and (b) ratchet the number of
 * catalog routes whose declared happy path was never observed.
 *
 * When `ROUTE_EXAMPLE_CAPTURE=1`, the first request/response body pair seen
 * per `(method, route, status)` is also flushed (as `examples-*.json`) for
 * `pnpm routes:examples`, which sanitizes and curates them into the committed
 * OpenAPI example fixtures.
 *
 * One file per app instance (pid + counter) keeps concurrent vitest lanes
 * from interleaving writes; the consumers deduplicate across files.
 */
export function createRouteStatusObserver(): RouteStatusObserver {
  const observed = new Set<string>();
  const examples = new Map<string, CapturedRouteExample>();
  const captureExamples = isRouteExampleCaptureEnabled();

  return {
    observeResponse: (observation) => {
      const key = `${observation.method} ${observation.routeUrl} ${observation.statusCode}`;
      observed.add(key);
      if (captureExamples && !examples.has(key)) {
        let responseBody: unknown;
        if (typeof observation.responseBody === 'string' && observation.responseBody.length > 0) {
          try {
            responseBody = JSON.parse(observation.responseBody);
          } catch {
            responseBody = undefined; // non-JSON payloads (HTML, metrics text) are not example material
          }
        }
        examples.set(key, {
          ...(observation.requestBody !== undefined && observation.requestBody !== null
            ? { request_body: observation.requestBody }
            : {}),
          ...(responseBody !== undefined ? { response_body: responseBody } : {}),
        });
      }
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
      if (examples.size > 0) {
        const examplesFile = join(
          observedDirectory,
          `examples-${process.pid}-${flushCounter}.json`,
        );
        writeFileSync(
          examplesFile,
          `${JSON.stringify(Object.fromEntries([...examples.entries()].sort()), null, 2)}\n`,
        );
      }
      observed.clear();
      examples.clear();
    },
  };
}
