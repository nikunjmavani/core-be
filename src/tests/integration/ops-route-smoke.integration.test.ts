import { describe, it, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  loadRoutesForDomain,
  buildRouteSmokeCases,
  assertRouteSmokeUnauthenticated,
} from '@/tests/helpers/route-http-coverage.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * Catalog route-smoke for the infrastructure-served internal ops routes
 * (`/internal/ops/circuit-breakers*`, Bearer `METRICS_SCRAPE_TOKEN`). ops has no
 * `src/domains/ops/` folder, so this suite — picked up by the global HTTP-test
 * scan via `loadRoutesForDomain('ops')` — provides the route-HTTP-coverage gate's
 * Tier-A signal for every ops route, including the `:circuitName` param route.
 */
const opsRoutes = loadRoutesForDomain('ops');
// ops routes are not organization-scoped; the materializer only substitutes `:id`,
// so any placeholder works for the (unused) organization id.
const UNUSED_ORGANIZATION_ID = 'ops-route-smoke';

describe('Ops route smoke (catalog)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of opsRoutes) {
    it(`${route.method} ${route.path} rejects unauthenticated`, async () => {
      const smokeCase = buildRouteSmokeCases(route, UNUSED_ORGANIZATION_ID);
      await assertRouteSmokeUnauthenticated(app, smokeCase);
    });
  }
});
