import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * Session invalidation security tests — verify that revoked, forged, malformed,
 * and cross-tenant tokens are rejected by the auth middleware.
 */
describe('Security: Session invalidation', () => {
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
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  async function createActiveUserWithToken() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [TENANCY_PERMISSIONS.ORGANIZATION_READ],
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { user, organization, token };
  }

  // POSITIVE — baseline: valid token returns 200
  it('should allow access with a valid token on an authenticated endpoint', async () => {
    const { token } = await createActiveUserWithToken();

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token,
    });

    expect(response.statusCode).toBe(200);
  });

  // NEGATIVE — token with non-existent userId (user never existed or was deleted)
  it('should return 401 for token where userId does not exist in the database', async () => {
    // Sign a JWT for a user that has no session row and no DB record.
    // `signAccessToken` only produces the JWT without touching the DB;
    // the auth middleware then calls `verifyActiveAccessToken` which looks up
    // the session row by token_hash — which will not exist — and throws 401.
    const ghostToken = await signAccessToken({
      userId: 'ghost-user-public-id-that-does-not-exist',
      role: 'user',
    });

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      headers: { authorization: `Bearer ${ghostToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  // NEGATIVE — token for user in org A used against org B resource
  it('should return 403 when org-A token is used against an org-B endpoint', async () => {
    const userA = await createActiveUserWithToken();
    const userB = await createActiveUserWithToken();

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${userB.organization.public_id}/settings`),
      token: userA.token,
      organizationPublicId: userB.organization.public_id,
    });

    expect([403, 404]).toContain(response.statusCode);
  });

  // NEGATIVE — revoked session token must be rejected
  it('should return 401 after a session is explicitly revoked', async () => {
    const { token, user } = await createActiveUserWithToken();

    // List sessions to obtain the session id we just created
    const listResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token,
    });
    expect(listResponse.statusCode).toBe(200);

    const sessions = (listResponse.json() as { data: { sessions: { id: string }[] } }).data
      ?.sessions;
    expect(sessions).toBeDefined();
    expect(sessions!.length).toBeGreaterThan(0);

    const sessionId = sessions![0]!.id;

    // Revoke that specific session via the DELETE endpoint
    const revokeResponse = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath(`/auth/me/sessions/${sessionId}`),
      token,
    });
    // 200 revoked successfully, or 404 if this was the session itself (implementation detail)
    expect([200, 204, 404]).toContain(revokeResponse.statusCode);
    void user;

    // Now using the same token must fail — session row is revoked / Redis cache invalidated
    const afterRevokeResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token,
    });

    expect(afterRevokeResponse.statusCode).toBe(401);
  });

  // NEGATIVE — revokeAllSessions then use old token
  it('should return 401 after DELETE /auth/me/sessions revokes all sessions', async () => {
    const { token } = await createActiveUserWithToken();

    // Revoke ALL sessions for this user
    const revokeAll = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath('/auth/me/sessions'),
      token,
    });
    expect([200, 204]).toContain(revokeAll.statusCode);

    // The same token must be rejected now
    const afterRevoke = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      token,
    });

    expect(afterRevoke.statusCode).toBe(401);
  });

  // NEGATIVE — token signed with a different (wrong) algorithm / tampered signature
  it('should return 401 for a token with a tampered payload', async () => {
    const { token } = await createActiveUserWithToken();
    const parts = token.split('.');
    // Swap out the payload with an attacker-crafted one (signature will be invalid)
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', role: 'super_admin', iat: Math.floor(Date.now() / 1000) }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      headers: { authorization: `Bearer ${tamperedToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  // NEGATIVE — completely malformed JWT (base64 corrupted)
  it('should return 401 for a malformed / corrupted JWT', async () => {
    const malformed = 'eyJhbGciOiJSUzI1NiJ9.CORRUPTED_PAYLOAD.BROKEN_SIGNATURE';

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      headers: { authorization: `Bearer ${malformed}` },
    });

    expect(response.statusCode).toBe(401);
  });

  // NEGATIVE — token with role claim tampered to super_admin must not bypass session check
  it('should return 401 for a token whose role claim is forged to super_admin', async () => {
    const { token } = await createActiveUserWithToken();
    const parts = token.split('.');
    // Decode original header and payload, forge role
    const originalHeader = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    const originalPayload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());

    const forgedPayload = { ...originalPayload, role: 'super_admin' };
    const forgedHeader = Buffer.from(JSON.stringify(originalHeader)).toString('base64url');
    const forgedBody = Buffer.from(JSON.stringify(forgedPayload)).toString('base64url');
    // Signature remains from original — will be invalid for this payload
    const forgedToken = `${forgedHeader}.${forgedBody}.${parts[2]}`;

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/me/sessions'),
      headers: { authorization: `Bearer ${forgedToken}` },
    });

    expect(response.statusCode).toBe(401);
  });
});
