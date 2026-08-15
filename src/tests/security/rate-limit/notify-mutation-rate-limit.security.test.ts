import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const WEBHOOK_PERMISSIONS = [NOTIFY_PERMISSIONS.WEBHOOK_READ, NOTIFY_PERMISSIONS.WEBHOOK_MANAGE];

/**
 * Notify's rate-limit coverage had two halves and neither closed the loop:
 * `notify-routes-rate-limit.policy.unit.test.ts` proves the preset is *written* in the route
 * file, and `preset-authed-burst.security.test.ts` proves the presets *work* — but nothing tied
 * the two together for notify, so a route whose `config` was silently dropped at registration
 * (spread into the wrong object, shadowed by a later key) would pass both.
 *
 * This file closes it in two steps:
 *   1. against the REAL app, the live limiter attached to each notify mutation reports the
 *      preset's own cap — runtime proof, not source-text proof;
 *   2. against an isolated app, the preset's real config bursts to 429 and buckets by actor.
 *
 * Step 2 injects a tiny `max` because `src/tests/setup.ts` sets `RATE_LIMIT_RELAXED_CAPS=true`,
 * which lifts every authed cap to 5000 so CI suites sharing a loopback IP do not flake. Driving
 * a real 429 through the app would need 5001 requests; feeding the preset's real key generator
 * into a small cap gives the same behavioural proof in milliseconds.
 */
describe('Security: notify mutation rate limiting', () => {
  describe('the live app attaches each notify mutation to its declared preset', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const { app: testApplication } = await createTestApp();
      app = testApplication;
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(async () => {
      await cleanupDatabase();
      await seedPermissions(WEBHOOK_PERMISSIONS);
    });

    async function createAuthorizedContext() {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: WEBHOOK_PERMISSIONS,
      });
      await createMembership({
        userId: user.id,
        organizationId: organization.id,
        roleId: role.id,
      });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      return { user, organization, token };
    }

    /**
     * Issues the request, retrying a 5xx once.
     *
     * The limiter decorates the reply on the preHandler hook, so a request shed before it lands
     * (readiness/store-unavailable 503, which carries `Retry-After` but no `X-RateLimit-*`)
     * would otherwise surface as a confusing "expected undefined" header mismatch rather than as
     * the infrastructure blip it is.
     */
    async function injectServed(
      options: Parameters<typeof injectAuthenticated>[1],
    ): Promise<Awaited<ReturnType<typeof injectAuthenticated>>> {
      let response = await injectAuthenticated(app, options);
      if (response.statusCode >= 500) {
        response = await injectAuthenticated(app, options);
      }
      expect(response.statusCode, `request was shed: ${response.body}`).toBeLessThan(500);
      return response;
    }

    it('POST /notify/webhooks/:webhook_id/test reports the STRICT cap', async () => {
      const { user, organization, token } = await createAuthorizedContext();
      const webhook = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://example.com/rate-limit-test-send',
        createdByUserId: user.id,
      });

      const response = await injectServed({
        method: 'POST',
        url: testApiPath(`/notify/webhooks/${webhook.public_id}/test`),
        token,
      });

      // The send itself may succeed or fail on the outbound call; the limiter runs on the
      // preHandler hook either way, and its header is what this case is about.
      expect(response.headers['x-ratelimit-limit']).toBe(
        String(STRICT_AUTHED_RATE_LIMIT.config.rateLimit.max),
      );
    });

    it('PATCH /notify/webhooks/:webhook_id reports the ORGANIZATION_SCOPED cap', async () => {
      const { user, organization, token } = await createAuthorizedContext();
      const webhook = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://example.com/rate-limit-patch',
        createdByUserId: user.id,
      });

      const response = await injectServed({
        method: 'PATCH',
        url: testApiPath(`/notify/webhooks/${webhook.public_id}`),
        token,
        payload: { is_enabled: false },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe(
        String(ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config.rateLimit.max),
      );
    });

    it('the two webhook mutations sit in different buckets from each other', async () => {
      // STRICT and ORGANIZATION_SCOPED are deliberately different caps. If a refactor collapsed
      // both routes onto one preset, the test-send route (the only notify route that emits
      // outbound traffic to a customer URL) would quietly inherit the looser budget.
      expect(STRICT_AUTHED_RATE_LIMIT.config.rateLimit.max).not.toBe(
        ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config.rateLimit.max,
      );
    });

    it('a notify read route does not carry the STRICT mutation cap', async () => {
      const { token } = await createAuthorizedContext();

      const response = await injectServed({
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
        token,
      });

      expect(response.statusCode).toBe(200);
      // Reads fall back to the GLOBAL limiter by design. Asserting the header is present as well
      // as different keeps this contrast honest: without the first assertion the case would also
      // pass if reads emitted no rate-limit header at all, which is a different (and wrong) world.
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-limit']).not.toBe(
        String(STRICT_AUTHED_RATE_LIMIT.config.rateLimit.max),
      );
    });
  });

  describe('the STRICT preset bursts to 429 and buckets per actor', () => {
    const apps: FastifyInstance[] = [];

    afterEach(async () => {
      while (apps.length > 0) {
        const app = apps.pop();
        if (app) await app.close();
      }
    });

    /** An isolated app carrying the preset's real key generator under an explicit small cap. */
    async function createBurstApp(max: number): Promise<FastifyInstance> {
      // trustProxy so the preset's IP fallback reads X-Forwarded-For rather than collapsing
      // every injected request onto the same loopback socket address.
      const app = Fastify({ trustProxy: true });
      await app.register(rateLimit, { global: false });
      app.post(
        '/webhooks/:webhook_id/test',
        {
          config: {
            rateLimit: {
              ...STRICT_AUTHED_RATE_LIMIT.config.rateLimit,
              max,
            },
          },
        },
        async () => ({ ok: true }),
      );
      await app.ready();
      apps.push(app);
      return app;
    }

    it('returns 429 once the cap is exceeded', async () => {
      const app = await createBurstApp(3);
      const headers = { 'x-forwarded-for': '203.0.113.10' };

      const statuses: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/webhooks/whk_test/test',
          headers,
        });
        statuses.push(response.statusCode);
      }

      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    });

    it('the 429 carries a Retry-After header', async () => {
      const app = await createBurstApp(1);
      const headers = { 'x-forwarded-for': '203.0.113.11' };

      await app.inject({ method: 'POST', url: '/webhooks/whk_test/test', headers });
      const blocked = await app.inject({
        method: 'POST',
        url: '/webhooks/whk_test/test',
        headers,
      });

      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('one caller exhausting the cap does not block a different caller', async () => {
      // The preset keys by authenticated user, falling back to IP. A shared bucket would let one
      // tenant's test-send loop deny every other tenant the same route.
      const app = await createBurstApp(1);

      const firstCaller = { 'x-forwarded-for': '203.0.113.20' };
      const secondCaller = { 'x-forwarded-for': '203.0.113.21' };

      const firstAllowed = await app.inject({
        method: 'POST',
        url: '/webhooks/whk_test/test',
        headers: firstCaller,
      });
      const firstBlocked = await app.inject({
        method: 'POST',
        url: '/webhooks/whk_test/test',
        headers: firstCaller,
      });
      const secondAllowed = await app.inject({
        method: 'POST',
        url: '/webhooks/whk_test/test',
        headers: secondCaller,
      });

      expect(firstAllowed.statusCode).toBe(200);
      expect(firstBlocked.statusCode).toBe(429);
      expect(secondAllowed.statusCode).toBe(200);
    });
  });
});
