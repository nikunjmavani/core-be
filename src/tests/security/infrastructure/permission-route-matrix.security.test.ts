import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { loadOrganizationPermissionRoutesFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import type { FastifyInstance } from 'fastify';

const organizationPermissionRoutes = loadOrganizationPermissionRoutesFromCatalog();
const PATH_PARAM_PLACEHOLDER = '000000000000000000000';

function materializeOrganizationScopedPath(path: string, organizationPublicId: string): string {
  return path.replace(':id', organizationPublicId).replace(/:[a-zA-Z]+/g, PATH_PARAM_PLACEHOLDER);
}

function payloadForPermissionRoute(
  route: (typeof organizationPermissionRoutes)[number],
  planPublicId: string = PATH_PARAM_PLACEHOLDER,
): Record<string, unknown> | undefined {
  if (route.method === 'GET' || route.method === 'DELETE') return undefined;
  if (route.path.includes('/subscriptions/:subscriptionId/change-plan')) {
    return { plan_id: planPublicId };
  }
  if (route.path.endsWith('/subscriptions')) {
    return { plan_id: planPublicId, billing_cycle: 'monthly' };
  }
  if (route.path.includes('/subscriptions/:subscriptionId')) {
    return { cancel_at_period_end: true };
  }
  if (route.path.endsWith('/api-keys')) {
    return { name: 'Matrix API key', scopes: ['read'] };
  }
  if (route.path.includes('/api-keys/:apiKeyId')) {
    return { name: 'Matrix API key updated' };
  }
  if (route.path.endsWith('/logo')) {
    return { key: 'organization-logos/matrix-logo.png' };
  }
  if (route.path.endsWith('/notification-policies')) {
    return { notification_type: 'billing', channel: 'email' };
  }
  if (route.path.includes('/notification-policies/:policyId')) {
    return { default_enabled: false };
  }
  if (route.path.endsWith('/webhooks')) {
    return { url: 'https://example.com/webhook', events: ['notification.created'] };
  }
  if (route.path.includes('/webhooks/:webhookId')) {
    return { is_enabled: false };
  }
  if (route.path.endsWith('/invitations')) {
    return { membership_id: PATH_PARAM_PLACEHOLDER, email: 'matrix@example.com' };
  }
  if (route.path.includes('/invitations/:invitationId/resend')) {
    return { expires_in_days: 7 };
  }
  if (route.path.endsWith('/memberships')) {
    return {
      user_id: PATH_PARAM_PLACEHOLDER,
      role_id: PATH_PARAM_PLACEHOLDER,
      status: 'ACTIVE',
    };
  }
  if (route.path.includes('/memberships/:membershipId')) {
    return { status: 'ACTIVE' };
  }
  if (route.path.endsWith('/roles')) {
    return { name: 'Matrix role' };
  }
  if (route.path.includes('/roles/:roleId/permissions')) {
    return { permission_codes: [] };
  }
  if (route.path.includes('/roles/:roleId')) {
    return { name: 'Matrix role updated' };
  }
  if (route.path.endsWith('/settings')) {
    return { is_email_notifications_enabled: true };
  }
  if (route.path.endsWith('/organizations/:id')) {
    return { name: 'Matrix organization' };
  }
  return {};
}

function routeNeedsExistingPlan(route: (typeof organizationPermissionRoutes)[number]): boolean {
  return (
    route.path.endsWith('/subscriptions') ||
    route.path.includes('/subscriptions/:subscriptionId/change-plan')
  );
}

function idempotencyHeadersForPermissionRoute(
  route: (typeof organizationPermissionRoutes)[number],
): Record<string, string> | undefined {
  if (route.method === 'GET' || route.method === 'DELETE') return undefined;
  return { 'idempotency-key': `permission-matrix-${randomUUID()}` };
}

/**
 * Authorization matrix — every org-permission route from docs/routes.txt returns 403 without permission.
 */
describe('Security: Permission route matrix', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
    expect(organizationPermissionRoutes.length).toBeGreaterThan(20);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  for (const route of organizationPermissionRoutes) {
    it(`${route.method} ${route.path} returns 403 without ${route.permissionCode}`, async () => {
      await seedPermissions([route.permissionCode]);

      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [],
        createdByUserId: user.id,
      });
      await createMembership({
        userId: user.id,
        organizationId: organization.id,
        roleId: role.id,
      });
      const token = await generateTestToken({ userId: user.public_id });
      const materializedPath = materializeOrganizationScopedPath(
        route.path,
        organization.public_id,
      );
      const plan = routeNeedsExistingPlan(route) ? await createTestPlan() : undefined;
      const headers = idempotencyHeadersForPermissionRoute(route);
      const payload = payloadForPermissionRoute(route, plan?.public_id);

      const response = await injectAuthenticated(app, {
        method: route.method,
        url: materializedPath,
        token,
        organizationPublicId: organization.public_id,
        ...(headers ? { headers } : {}),
        ...(payload !== undefined ? { payload } : {}),
      });

      expect(response.statusCode, response.body).toBe(403);
    });

    it(`${route.method} ${route.path} does not return 403 with ${route.permissionCode}`, async () => {
      await seedPermissions([route.permissionCode]);

      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [route.permissionCode],
        createdByUserId: user.id,
      });
      await createMembership({
        userId: user.id,
        organizationId: organization.id,
        roleId: role.id,
      });
      await invalidatePermissions(user.public_id, organization.public_id);
      const token = await generateTestToken({ userId: user.public_id });
      const materializedPath = materializeOrganizationScopedPath(
        route.path,
        organization.public_id,
      );
      const plan = routeNeedsExistingPlan(route) ? await createTestPlan() : undefined;
      const headers = idempotencyHeadersForPermissionRoute(route);
      const payload = payloadForPermissionRoute(route, plan?.public_id);

      const response = await injectAuthenticated(app, {
        method: route.method,
        url: materializedPath,
        token,
        organizationPublicId: organization.public_id,
        ...(headers ? { headers } : {}),
        ...(payload !== undefined ? { payload } : {}),
      });

      expect(response.statusCode).not.toBe(403);
    });
  }
});
