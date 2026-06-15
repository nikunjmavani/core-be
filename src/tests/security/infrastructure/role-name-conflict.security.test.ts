import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticatedOrganizationMutation } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';

/**
 * Role-name uniqueness conflict handling.
 *
 * Roles have a unique `(organization_id, name)` index. Creating a role with a
 * name that already exists — sequentially or under concurrency — must be a clean
 * 409 conflict, never a 500 from an unhandled Postgres unique_violation.
 */
function tally(statuses: number[]) {
  return {
    created: statuses.filter((s) => s === 201).length,
    conflict: statuses.filter((s) => s === 409).length,
    serverError: statuses.filter((s) => s >= 500).length,
  };
}

describe('Security: role-name uniqueness conflict', () => {
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
    await seedPermissions(['role:manage', 'role:read']);
  });

  async function adminContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['role:manage', 'role:read'],
    });
    await createMembership({ userId: user.id, organizationId: organization.id, roleId: role.id });
    // Flat role routes resolve the organization from the JWT `org` claim.
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { organization, token };
  }

  async function createRole(token: string, name: string) {
    return injectAuthenticatedOrganizationMutation(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organization/roles'),
      token,
      payload: { name },
    });
  }

  it('a sequential duplicate role name is a clean 409 (not a 500)', async () => {
    const { token } = await adminContext();
    const first = await createRole(token, 'Duplicate Role');
    expect(first.statusCode).toBe(201);

    const second = await createRole(token, 'Duplicate Role');
    expect(second.statusCode).toBe(409);
  });

  it('concurrent creates with the same name: exactly one 201, rest 409, no 5xx', async () => {
    const { token } = await adminContext();
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => createRole(token, 'Race Role').then((r) => r.statusCode)),
    );
    const result = tally(statuses);
    expect(result.serverError).toBe(0);
    expect(result.created).toBe(1);
    expect(result.conflict).toBe(4);
  });

  it('a different name still succeeds (the guard is name-specific)', async () => {
    const { token } = await adminContext();
    expect((await createRole(token, 'Alpha')).statusCode).toBe(201);
    expect((await createRole(token, 'Beta')).statusCode).toBe(201);
  });
});
