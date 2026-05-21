import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  loadRoutesForDomain,
  buildRouteSmokeCases,
  assertRouteSmokeUnauthenticated,
} from '@/tests/helpers/route-http-coverage.helper.js';
import type { FastifyInstance } from 'fastify';

const billingRoutes = loadRoutesForDomain('billing').filter(
  (route) => !route.path.includes('/webhook'),
);

describe('Billing route smoke (catalog)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  for (const route of billingRoutes) {
    it(`${route.method} ${route.path} rejects unauthenticated or allows public`, async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const smokeCase = buildRouteSmokeCases(route, organization.public_id);
      await assertRouteSmokeUnauthenticated(app, smokeCase);
    });
  }
});
