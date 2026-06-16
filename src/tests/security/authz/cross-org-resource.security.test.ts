import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestApiKey } from '@/tests/factories/organization-api-key.factory.js';
import { createTestNotificationPolicy } from '@/tests/factories/organization-notification-policy.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

/**
 * Cross-organization isolation matrix — model `org` in
 * route-authorization-model.json. A member of organization A — holding the
 * relevant read permission IN their own org — must never resolve organization
 * B's resources: every cross-org GET returns 404 (RLS scopes the lookup to the
 * active org from the JWT claim), while the identical same-org GET succeeds.
 * Covers the org-scoped resources across the tenancy and notify domains.
 * e2e — runs in CI (Postgres + Redis required).
 */
describe('Security: cross-organization resource isolation (model: org)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  // Read permissions for every org-scoped resource exercised below. The member
  // holds these in their OWN org, so a cross-org 404 proves tenant scoping — not a
  // missing permission (which would surface as 403).
  const READER_PERMISSION_CODES = [
    TENANCY_PERMISSIONS.API_KEY_READ,
    TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
    TENANCY_PERMISSIONS.ROLE_READ,
    TENANCY_PERMISSIONS.MEMBERSHIP_READ,
    NOTIFY_PERMISSIONS.WEBHOOK_READ,
  ];

  // An org with a non-owner member who can read every resource type, plus one of
  // each org-scoped resource. The member token carries the org via its JWT claim.
  async function orgWithResources() {
    await seedPermissions(READER_PERMISSION_CODES);
    const owner = await createTestUser();
    const member = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: READER_PERMISSION_CODES,
      createdByUserId: owner.id,
    });
    const membership = await createMembership({
      userId: member.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const apiKey = await createTestApiKey({
      organizationId: organization.id,
      createdByUserId: owner.id,
    });
    const policy = await createTestNotificationPolicy({
      organizationId: organization.id,
      createdByUserId: owner.id,
    });
    const webhook = await createTestWebhook({
      organizationId: organization.id,
      createdByUserId: owner.id,
    });
    const memberToken = await generateTestToken({
      userId: member.public_id,
      organizationPublicId: organization.public_id,
    });
    return { organization, member, memberToken, role, membership, apiKey, policy, webhook };
  }

  type OrgFixture = Awaited<ReturnType<typeof orgWithResources>>;

  const resourceCases: ReadonlyArray<{ label: string; path: (org: OrgFixture) => string }> = [
    { label: 'API key', path: (org) => `/tenancy/organization/api-keys/${org.apiKey.public_id}` },
    {
      label: 'notification policy',
      path: (org) => `/tenancy/organization/notification-policies/${org.policy.public_id}`,
    },
    { label: 'role', path: (org) => `/tenancy/organization/roles/${org.role.public_id}` },
    {
      label: 'membership',
      path: (org) => `/tenancy/organization/memberships/${org.membership.public_id}`,
    },
    { label: 'webhook', path: (org) => `/notify/webhooks/${org.webhook.public_id}` },
    {
      label: 'webhook delivery-attempts',
      path: (org) => `/notify/webhooks/${org.webhook.public_id}/delivery-attempts`,
    },
    {
      label: 'membership permissions',
      path: (org) => `/tenancy/organization/memberships/${org.membership.public_id}/permissions`,
    },
    {
      label: 'role permissions',
      path: (org) => `/tenancy/organization/roles/${org.role.public_id}/permissions`,
    },
  ];

  describe('cross-org reads are scoped out (404)', () => {
    it.each(resourceCases)('member of org A GET org B $label → 404', async ({ path }) => {
      const orgA = await orgWithResources();
      const orgB = await orgWithResources();
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(path(orgB)),
        token: orgA.memberToken,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('same-org reads succeed (200) — proves the 404 is scoping, not a missing permission', () => {
    it.each(resourceCases)('member GET own org $label → 200', async ({ path }) => {
      const org = await orgWithResources();
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(path(org)),
        token: org.memberToken,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // by-slug is auth-only (no permission preHandler); the service rejects a
  // non-member with 404. Driven separately from the by-id cases above with an
  // explicit, route-valid slug (the auto-generated factory slug can violate the
  // stricter SLUG_REGEX the :slug param enforces).
  describe('organization by-slug is org-scoped', () => {
    async function orgWithMemberAndSlug(slug: string) {
      await seedPermissions(READER_PERMISSION_CODES);
      const owner = await createTestUser();
      const member = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id, slug });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: READER_PERMISSION_CODES,
        createdByUserId: owner.id,
      });
      await createMembership({
        userId: member.id,
        organizationId: organization.id,
        roleId: role.id,
      });
      const memberToken = await generateTestToken({
        userId: member.public_id,
        organizationPublicId: organization.public_id,
      });
      return { organization, memberToken };
    }
    const uniqueSlug = () => `authz-slug-${randomUUID().slice(0, 8)}`;

    it("member of org A GET org B's organization by-slug → 404", async () => {
      const orgA = await orgWithMemberAndSlug(uniqueSlug());
      const orgB = await orgWithMemberAndSlug(uniqueSlug());
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/by-slug/${orgB.organization.slug}`),
        token: orgA.memberToken,
      });
      expect(res.statusCode).toBe(404);
    });

    it('baseline: member GET own organization by-slug → 200', async () => {
      const org = await orgWithMemberAndSlug(uniqueSlug());
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/by-slug/${org.organization.slug}`),
        token: org.memberToken,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
