import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectRoute } from '@/tests/helpers/test-http-inject.helper.js';
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

  describe('happy path with the metrics bearer token', () => {
    // src/tests/setup.ts pins METRICS_SCRAPE_TOKEN for every test run.
    const bearerToken = process.env.METRICS_SCRAPE_TOKEN as string;

    it('GET /internal/ops/circuit-breakers lists managed circuits', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: '/internal/ops/circuit-breakers',
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = JSON.parse(response.body) as { circuits: Array<{ name: string }> };
      expect(body.circuits.map((circuit) => circuit.name)).toContain('stripe');
    });

    it('POST /internal/ops/circuit-breakers/:circuitName/reset resets a managed circuit', async () => {
      const response = await injectRoute(app, {
        method: 'POST',
        url: '/internal/ops/circuit-breakers/stripe/reset',
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      expect(response.statusCode, response.body).toBe(200);
    });
  });
});
