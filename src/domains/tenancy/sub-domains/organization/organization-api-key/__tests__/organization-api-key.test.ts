import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
  injectUnauthenticated,
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
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import type { FastifyInstance } from 'fastify';

const TENANCY_PERMISSION_CODES = Object.values(TENANCY_PERMISSIONS);

/** Permissions needed to create API keys whose scopes include `api-key:read`. */
const API_KEY_MANAGER_WITH_READ_GRANT = [
  TENANCY_PERMISSIONS.API_KEY_MANAGE,
  TENANCY_PERMISSIONS.API_KEY_READ,
];

describe('Tenancy Organization API Key Sub-Domain — Integration', () => {
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
    await seedPermissions(TENANCY_PERMISSION_CODES);
  });

  async function createAuthorizedOrganizationContext(permissionCodes: string[]) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const user = await createTestUser({ email: `api-key-${uniqueSuffix}@test.com` });
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { user, organization, role, token };
  }

  function apiKeysCollectionPath(organizationPublicId: string) {
    return `/api/v1/tenancy/organizations/${organizationPublicId}/api-keys`;
  }

  function apiKeysResourcePath(organizationPublicId: string, apiKeyPublicId: string) {
    return `/api/v1/tenancy/organizations/${organizationPublicId}/api-keys/${apiKeyPublicId}`;
  }

  async function expectApiKeyNotFound(
    organizationPublicId: string,
    apiKeyPublicId: string,
    token: string,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          const response = await injectAuthenticated(app, {
            url: apiKeysResourcePath(organizationPublicId, apiKeyPublicId),
            token,
          });
          return response.statusCode;
        },
        { timeout: 3000, interval: 25 },
      )
      .toBe(404);
  }

  describe('GET /api/v1/tenancy/organizations/:id/api-keys', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: apiKeysCollectionPath('unauthenticated-organization-route'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: apiKeysCollectionPath(organization.public_id),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return api keys with read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: apiKeysCollectionPath(organization.public_id),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/tenancy/organizations/:id/api-keys/:api_key_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: apiKeysResourcePath('unauthenticated-organization-route', 'some-key-id'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: apiKeysResourcePath(organization.public_id, 'some-key-id'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent api key', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: apiKeysResourcePath(organization.public_id, 'key_yyyyyyyyyyyyyyyyyyyyy'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should return api key by public id', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Listing Test Key', scopes: ['api-key:read'], expires_in_days: 365 },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createdBody.data.api_key.id;

      const response = await injectAuthenticated(app, {
        url: apiKeysResourcePath(organization.public_id, apiKeyPublicId),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { id: string; name: string } };
      expect(body.data).toHaveProperty('id', apiKeyPublicId);
      expect(body.data).toHaveProperty('name', 'Listing Test Key');
    });
  });

  describe('POST /api/v1/tenancy/organizations/:id/api-keys', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: apiKeysCollectionPath('unauthenticated-organization-route'),
        payload: { name: 'Test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key manage permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Test', scopes: ['organization:read'] },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when name is missing', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when name is empty', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: '' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when body contains unknown keys', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Valid Key', unexpected: true },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should create api key when manage permission is granted', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'New Key', scopes: ['api-key:manage'], expires_in_days: 30 },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        data: { api_key: { name: string }; raw_key: string };
      };
      expect(body.data.api_key).toHaveProperty('name', 'New Key');
      expect(body.data.raw_key).toMatch(/^ak_/);
    });
  });

  describe('PATCH /api/v1/tenancy/organizations/:id/api-keys/:api_key_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: apiKeysResourcePath('unauthenticated-organization-route', 'some-key-id'),
        payload: { name: 'Renamed' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key manage permission', async () => {
      const managerContext = await createAuthorizedOrganizationContext(
        API_KEY_MANAGER_WITH_READ_GRANT,
      );
      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(managerContext.organization.public_id),
        token: managerContext.token,
        payload: { name: 'Owned By Manager', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const readOnlyUser = await createTestUser({
        email: 'api-key-read-only-patch@test.com',
      });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: managerContext.organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.API_KEY_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: managerContext.organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const patchResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: apiKeysResourcePath(managerContext.organization.public_id, apiKeyPublicId),
        token: readOnlyToken,
        payload: { name: 'Should Fail' },
      });
      expect(patchResponse.statusCode).toBe(403);
    });

    it('should return 400 when status value is invalid', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext(
        API_KEY_MANAGER_WITH_READ_GRANT,
      );

      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Patch Status Key', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: apiKeysResourcePath(organization.public_id, apiKeyPublicId),
        token,
        payload: { status: 'INVALID_STATUS' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should update api key with manage permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext(
        API_KEY_MANAGER_WITH_READ_GRANT,
      );

      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Before Rename', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const patchResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: apiKeysResourcePath(organization.public_id, apiKeyPublicId),
        token,
        payload: { name: 'After Rename', status: 'REVOKED' },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patchBody = patchResponse.json() as { data: { name: string; status: string } };
      expect(patchBody.data.name).toBe('After Rename');
      expect(patchBody.data.status).toBe('REVOKED');
    });
  });

  describe('DELETE /api/v1/tenancy/organizations/:id/api-keys/:api_key_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: apiKeysResourcePath('unauthenticated-organization-route', 'some-key-id'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key manage permission', async () => {
      const managerContext = await createAuthorizedOrganizationContext(
        API_KEY_MANAGER_WITH_READ_GRANT,
      );
      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(managerContext.organization.public_id),
        token: managerContext.token,
        payload: { name: 'Deletion Target', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const readOnlyUser = await createTestUser({
        email: 'api-key-read-only-delete@test.com',
      });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: managerContext.organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.API_KEY_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: managerContext.organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const deleteResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: apiKeysResourcePath(managerContext.organization.public_id, apiKeyPublicId),
        token: readOnlyToken,
      });
      expect(deleteResponse.statusCode).toBe(403);
    });

    it('should return 404 when api key does not exist', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: apiKeysResourcePath(organization.public_id, 'key_yyyyyyyyyyyyyyyyyyyyy'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should delete api key when manage permission is granted', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'To Delete', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const deleteResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: apiKeysResourcePath(organization.public_id, apiKeyPublicId),
        token,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const listAfterDelete = await injectAuthenticated(app, {
        url: apiKeysCollectionPath(organization.public_id),
        token,
      });
      expect(listAfterDelete.statusCode).toBe(200);
      const listBody = listAfterDelete.json() as { data: Array<{ id: string }> };
      const listedIds = listBody.data.map((row) => row.id);
      expect(listedIds).not.toContain(apiKeyPublicId);

      await expectApiKeyNotFound(organization.public_id, apiKeyPublicId, token);
    });
  });

  describe('POST /api/v1/tenancy/organizations/:id/api-keys/:api_key_id/rotate', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: `${apiKeysResourcePath('unauthenticated-organization-route', 'some-key-id')}/rotate`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without api key manage permission', async () => {
      const managerContext = await createAuthorizedOrganizationContext(
        API_KEY_MANAGER_WITH_READ_GRANT,
      );
      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(managerContext.organization.public_id),
        token: managerContext.token,
        payload: { name: 'Rotate Protected', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as { data: { api_key: { id: string } } };
      const apiKeyPublicId = createBody.data.api_key.id;

      const readOnlyUser = await createTestUser({
        email: 'api-key-read-only-rotate@test.com',
      });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: managerContext.organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.API_KEY_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: managerContext.organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const rotateResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: `${apiKeysResourcePath(managerContext.organization.public_id, apiKeyPublicId)}/rotate`,
        token: readOnlyToken,
      });
      expect(rotateResponse.statusCode).toBe(403);
    });

    it('should return 404 when api key does not exist', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: `${apiKeysResourcePath(organization.public_id, 'key_yyyyyyyyyyyyyyyyyyyyy')}/rotate`,
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should rotate api key and return raw key payload', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Rotation Source', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const createBody = createResponse.json() as {
        data: { raw_key: string; api_key: { id: string } };
      };
      const firstRawKey = createBody.data.raw_key;
      const apiKeyPublicIdBeforeRotation = createBody.data.api_key.id;

      const rotateResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: `${apiKeysResourcePath(organization.public_id, apiKeyPublicIdBeforeRotation)}/rotate`,
        token,
      });
      expect(rotateResponse.statusCode).toBe(201);
      const rotateBody = rotateResponse.json() as {
        data: { raw_key: string; api_key: { id: string; name: string } };
      };
      expect(rotateBody.data.raw_key).toMatch(/^ak_/);
      expect(rotateBody.data.raw_key).not.toBe(firstRawKey);
      expect(rotateBody.data.api_key.name).toBe('Rotation Source');

      const apiKeyPublicIdAfterRotation = rotateBody.data.api_key.id;
      expect(apiKeyPublicIdAfterRotation).not.toBe(apiKeyPublicIdBeforeRotation);

      const listAfterRotate = await injectAuthenticated(app, {
        url: apiKeysCollectionPath(organization.public_id),
        token,
      });
      expect(listAfterRotate.statusCode).toBe(200);
      const listBody = listAfterRotate.json() as { data: Array<{ id: string }> };
      const listedIdsAfterRotate = listBody.data.map((row) => row.id);
      expect(listedIdsAfterRotate).not.toContain(apiKeyPublicIdBeforeRotation);
      expect(listedIdsAfterRotate).toContain(apiKeyPublicIdAfterRotation);

      await expectApiKeyNotFound(organization.public_id, apiKeyPublicIdBeforeRotation, token);

      const rotatedKeyLookup = await injectAuthenticated(app, {
        url: apiKeysResourcePath(organization.public_id, apiKeyPublicIdAfterRotation),
        token,
      });
      expect(rotatedKeyLookup.statusCode).toBe(200);
    });

    it('rejects concurrent rotations of the same key: one replacement, rest 409, no 5xx', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.API_KEY_MANAGE,
      ]);

      const createResponse = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: apiKeysCollectionPath(organization.public_id),
        token,
        payload: { name: 'Concurrent Rotation Source', scopes: ['api-key:read'] },
      });
      expect(createResponse.statusCode).toBe(201);
      const apiKeyPublicId = (createResponse.json() as { data: { api_key: { id: string } } }).data
        .api_key.id;

      const rotateOnce = () =>
        injectAuthenticatedOrganizationMutation(app, {
          method: 'POST',
          url: `${apiKeysResourcePath(organization.public_id, apiKeyPublicId)}/rotate`,
          token,
        }).then((response) => response.statusCode);

      // A single rotate must yield exactly one replacement. Without the atomic soft-delete guard,
      // all four requests find the live key, all soft-delete it, and all mint a replacement — four
      // keys for one rotation. With the guard, exactly one wins; the losers are a 4xx (404 if the
      // key was already retired by the time they look it up, 409 if they lose the soft-delete race
      // — both are timing-dependent, so we assert the invariant, not the exact split).
      const statuses = await Promise.all([rotateOnce(), rotateOnce(), rotateOnce(), rotateOnce()]);
      expect(statuses.filter((status) => status >= 500)).toHaveLength(0);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status >= 400 && status < 500)).toHaveLength(3);

      // Exactly one active key remains (the single replacement); the original is retired. Without
      // the guard this list would hold four replacements.
      const listAfter = await injectAuthenticated(app, {
        url: apiKeysCollectionPath(organization.public_id),
        token,
      });
      expect(listAfter.statusCode).toBe(200);
      const activeKeys = (listAfter.json() as { data: Array<{ id: string }> }).data;
      expect(activeKeys).toHaveLength(1);
      expect(activeKeys[0]?.id).not.toBe(apiKeyPublicId);
    });
  });
});
