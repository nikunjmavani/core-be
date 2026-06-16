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
 * Cross-organization MUTATION isolation matrix — model `org` (write side) in
 * route-authorization-model.json. The read-side counterpart lives in
 * cross-org-resource.security.test.ts; here a member of org A who holds the
 * relevant MANAGE permission in their own org still cannot mutate org B's
 * resources: every cross-org DELETE / rotate returns 404 (RLS scopes the lookup
 * to the active org), so no cross-tenant write is possible — the handler never
 * resolves the row. An Idempotency-Key is supplied so idempotency-required
 * writes reach the scoping check rather than the missing-key 422 gate.
 * e2e — runs in CI (Postgres + Redis required).
 */
describe('Security: cross-organization mutation isolation (model: org — writes)', () => {
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

  // Every tenancy + notify permission, so the acting member clears each route's
  // MANAGE gate in their OWN org — a cross-org 404 therefore proves tenant
  // scoping, not a missing permission (which would surface as 403).
  const ALL_PERMISSION_CODES = [
    ...Object.values(TENANCY_PERMISSIONS),
    ...Object.values(NOTIFY_PERMISSIONS),
  ];

  async function orgWithResources() {
    await seedPermissions(ALL_PERMISSION_CODES);
    const owner = await createTestUser();
    const member = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ALL_PERMISSION_CODES,
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

  const mutationCases: ReadonlyArray<{
    label: string;
    method: 'DELETE' | 'POST';
    target: (org: OrgFixture) => string;
  }> = [
    {
      label: 'webhook DELETE',
      method: 'DELETE',
      target: (org) => `/notify/webhooks/${org.webhook.public_id}`,
    },
    {
      label: 'API key DELETE',
      method: 'DELETE',
      target: (org) => `/tenancy/organization/api-keys/${org.apiKey.public_id}`,
    },
    {
      label: 'API key rotate',
      method: 'POST',
      target: (org) => `/tenancy/organization/api-keys/${org.apiKey.public_id}/rotate`,
    },
    {
      label: 'role DELETE',
      method: 'DELETE',
      target: (org) => `/tenancy/organization/roles/${org.role.public_id}`,
    },
    {
      label: 'notification policy DELETE',
      method: 'DELETE',
      target: (org) => `/tenancy/organization/notification-policies/${org.policy.public_id}`,
    },
    {
      label: 'membership DELETE',
      method: 'DELETE',
      target: (org) => `/tenancy/organization/memberships/${org.membership.public_id}`,
    },
  ];

  it.each(
    mutationCases,
  )('member of org A $label on an org B resource → 404 (no cross-org write)', async ({
    method,
    target,
  }) => {
    const orgA = await orgWithResources();
    const orgB = await orgWithResources();
    const res = await injectAuthenticated(app, {
      method,
      url: testApiPath(target(orgB)),
      token: orgA.memberToken,
      extraHeaders: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });
});
