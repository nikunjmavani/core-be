import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';

/**
 * BOLA / IDOR cross-tenant sweep on the by-:id routes.
 *
 * The existing tenant-isolation suite covers list endpoints; this covers the
 * classic IDOR vector — fetching/mutating a specific resource by id that belongs
 * to another organization.
 *
 * Tenancy by-id routes were flattened (`/tenancy/organization/roles/:role_id`,
 * `/tenancy/organization/memberships/:membership_id`) so the organization is
 * resolved from the JWT `org` claim — there is no organization path segment to
 * point at org B. The only addressable attack shape is therefore the real guard:
 *  - foreign-resource-id: the attacker, fully privileged in their OWN org A
 *    (token scoped to A via the `org` claim), puts org B's resource id in the
 *    flat route → 404 (the org-scoped lookup runs under org A's RLS context, so
 *    the foreign resource is invisible). Privileges in your org must never reach
 *    another org's objects.
 */
const ALL_PERMISSIONS = [
  'webhook:read',
  'webhook:manage',
  'role:read',
  'role:manage',
  'membership:read',
  'membership:manage',
];

describe('Security: BOLA / IDOR cross-tenant (by-id)', () => {
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
    await seedPermissions(ALL_PERMISSIONS);
  });

  /**
   * Builds org A (attacker, fully privileged in their own org) and org B (victim,
   * with a webhook, a role, and a membership). Returns org-A's admin token plus
   * the public ids needed to address org B's resources.
   */
  async function setup() {
    const attacker = await createTestUser();
    const orgA = await createTestOrganization({ ownerUserId: attacker.id });
    const roleA = await createRoleWithPermissions({
      organizationId: orgA.id,
      permissionCodes: ALL_PERMISSIONS,
    });
    await createMembership({ userId: attacker.id, organizationId: orgA.id, roleId: roleA.id });

    const victimOwner = await createTestUser();
    const orgB = await createTestOrganization({ ownerUserId: victimOwner.id });
    const webhookB = await createTestWebhook({ organizationId: orgB.id });
    const roleB = await createRoleWithPermissions({
      organizationId: orgB.id,
      permissionCodes: ['webhook:read'],
    });
    const victimMember = await createTestUser();
    const membershipB = await createMembership({
      userId: victimMember.id,
      organizationId: orgB.id,
      roleId: roleB.id,
    });

    return { attacker, orgA, orgB, webhookB, roleB, membershipB };
  }

  // Each tuple: a flat by-id resource path builder (organization resolved from
  // the JWT `org` claim, so only the resource id is in the path). Webhook is
  // covered by the dedicated flat-route tests below, mirroring the billing by-id
  // pattern.
  const RESOURCES = [
    {
      name: 'role',
      path: (id: string) => `/tenancy/organization/roles/${id}`,
    },
    {
      name: 'membership',
      path: (id: string) => `/tenancy/organization/memberships/${id}`,
    },
  ] as const;

  function resourceId(name: string, resources: Awaited<ReturnType<typeof setup>>): string {
    if (name === 'role') return resources.roleB.public_id;
    return resources.membershipB.public_id;
  }

  // ─── foreign-resource-id (org B's id inside org A's claim context) → 404 ─────
  //
  // With flat routes there is no org path param, so "address org B directly"
  // (the old cross-org-id shape) is no longer expressible — an actor only ever
  // addresses its own claim org. The surviving (and real) IDOR guard: org B's
  // resource id placed in the flat route while the attacker is scoped to org A.

  describe('foreign-resource-id: org B resource id inside org A context', () => {
    for (const resource of RESOURCES) {
      it(`GET org B's ${resource.name} via org A → not found`, async () => {
        const ctx = await setup();
        // Attacker scoped to org A via the `org` claim; flat route resolves to A.
        const tokenScopedToA = await generateTestToken({
          userId: ctx.attacker.public_id,
          organizationPublicId: ctx.orgA.public_id,
        });
        const response = await injectAuthenticated(app, {
          method: 'GET',
          url: testApiPath(resource.path(resourceId(resource.name, ctx))),
          token: tokenScopedToA,
        });
        // Attacker IS authorized in org A, so this reaches the org-scoped lookup,
        // which must not find org B's resource.
        expect(response.statusCode).toBe(404);
      });
    }

    it("GET org B's webhook via org A → not found (flat route, org from claim)", async () => {
      const ctx = await setup();
      // Attacker IS authorized in org A (token scoped to A via the `org` claim),
      // so the flat webhook route resolves to org A and the org-scoped lookup must
      // not find org B's webhook.
      const tokenScopedToA = await generateTestToken({
        userId: ctx.attacker.public_id,
        organizationPublicId: ctx.orgA.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/webhooks/${ctx.webhookB.public_id}`),
        token: tokenScopedToA,
      });
      expect(response.statusCode).toBe(404);
    });

    it("DELETE org B's webhook via org A → not found (no cross-tenant mutation)", async () => {
      const ctx = await setup();
      const tokenScopedToA = await generateTestToken({
        userId: ctx.attacker.public_id,
        organizationPublicId: ctx.orgA.public_id,
      });
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: testApiPath(`/notify/webhooks/${ctx.webhookB.public_id}`),
        token: tokenScopedToA,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Baseline: same-org access works (proves the guard is specific) ─────────

  it('baseline: a user can GET a webhook in their OWN org (200)', async () => {
    const ctx = await setup();
    const ownWebhook = await createTestWebhook({ organizationId: ctx.orgA.id });
    // Flat route: org A resolved from the `org` claim, webhook owned by org A.
    const tokenScopedToA = await generateTestToken({
      userId: ctx.attacker.public_id,
      organizationPublicId: ctx.orgA.public_id,
    });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/notify/webhooks/${ownWebhook.public_id}`),
      token: tokenScopedToA,
    });
    expect(response.statusCode).toBe(200);
  });
});
