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
 * to another organization. Two attack shapes per resource:
 *  - cross-org-id: the attacker addresses org B's URL directly with their own
 *    token → 403 (no membership/permission in org B), and
 *  - foreign-resource-id: the attacker, fully privileged in their OWN org A,
 *    puts org B's resource id in an org-A URL → 404 (the lookup is org-scoped, so
 *    the foreign resource is invisible). This is the real guard: privileges in
 *    your org must never reach another org's objects.
 */
const ALL_PERMISSIONS = [
  'webhook:read',
  'webhook:manage',
  'role:read',
  'role:manage',
  'membership:read',
  'membership:manage',
];

function expectCrossTenantDenied(statusCode: number): void {
  expect(statusCode).not.toBe(200);
  expect(statusCode).not.toBe(204);
  expect([403, 404]).toContain(statusCode);
}

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
    const attackerToken = await generateTestToken({ userId: attacker.public_id });

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

    return { attackerToken, orgA, orgB, webhookB, roleB, membershipB };
  }

  // Each tuple: a by-id resource path builder for a given org + resource id.
  const RESOURCES = [
    {
      name: 'webhook',
      path: (org: string, id: string) => `/notify/organizations/${org}/webhooks/${id}`,
    },
    {
      name: 'role',
      path: (org: string, id: string) => `/tenancy/organizations/${org}/roles/${id}`,
    },
    {
      name: 'membership',
      path: (org: string, id: string) => `/tenancy/organizations/${org}/memberships/${id}`,
    },
  ] as const;

  function resourceId(name: string, resources: Awaited<ReturnType<typeof setup>>): string {
    if (name === 'webhook') return resources.webhookB.public_id;
    if (name === 'role') return resources.roleB.public_id;
    return resources.membershipB.public_id;
  }

  // ─── Shape 1: cross-org-id (address org B directly) → 403 ────────────────────

  describe('cross-org-id: attacker addresses org B directly', () => {
    for (const resource of RESOURCES) {
      it(`GET ${resource.name} in org B → denied`, async () => {
        const ctx = await setup();
        const response = await injectAuthenticated(app, {
          method: 'GET',
          url: testApiPath(resource.path(ctx.orgB.public_id, resourceId(resource.name, ctx))),
          token: ctx.attackerToken,
          organizationPublicId: ctx.orgB.public_id,
        });
        expectCrossTenantDenied(response.statusCode);
      });
    }
  });

  // ─── Shape 2: foreign-resource-id (org B's id in an org-A URL) → 404 ─────────

  describe('foreign-resource-id: org B resource id inside org A context', () => {
    for (const resource of RESOURCES) {
      it(`GET org B's ${resource.name} via org A → not found`, async () => {
        const ctx = await setup();
        const response = await injectAuthenticated(app, {
          method: 'GET',
          url: testApiPath(resource.path(ctx.orgA.public_id, resourceId(resource.name, ctx))),
          token: ctx.attackerToken,
          organizationPublicId: ctx.orgA.public_id,
        });
        // Attacker IS authorized in org A, so this reaches the org-scoped lookup,
        // which must not find org B's resource.
        expect(response.statusCode).toBe(404);
      });
    }

    it("DELETE org B's webhook via org A → not found (no cross-tenant mutation)", async () => {
      const ctx = await setup();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: testApiPath(
          `/notify/organizations/${ctx.orgA.public_id}/webhooks/${ctx.webhookB.public_id}`,
        ),
        token: ctx.attackerToken,
        organizationPublicId: ctx.orgA.public_id,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Baseline: same-org access works (proves the guard is specific) ─────────

  it('baseline: a user can GET a webhook in their OWN org (200)', async () => {
    const ctx = await setup();
    const ownWebhook = await createTestWebhook({ organizationId: ctx.orgA.id });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(
        `/notify/organizations/${ctx.orgA.public_id}/webhooks/${ownWebhook.public_id}`,
      ),
      token: ctx.attackerToken,
      organizationPublicId: ctx.orgA.public_id,
    });
    expect(response.statusCode).toBe(200);
  });
});
