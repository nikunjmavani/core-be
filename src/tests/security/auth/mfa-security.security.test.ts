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
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * MFA security tests — verify that the TOTP verify endpoint rejects wrong
 * codes, empty inputs, and missing MFA-session tokens on the public login flow.
 *
 * Routes covered:
 *   POST /api/v1/auth/me/mfa/verify      — authenticated; verifies a TOTP code
 *   POST /api/v1/auth/mfa/login       — public; completes MFA login with session token
 */
describe('Security: MFA', () => {
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

  describe('POST /auth/me/mfa/verify (authenticated TOTP verification)', () => {
    // NEGATIVE — wrong TOTP code (6 digits, but incorrect value) returns 401
    it('should return 401 for a wrong TOTP code when MFA is not enrolled', async () => {
      const { token } = await createActiveUserWithToken();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: { code: '000000' },
      });

      // User has no MFA enrolled; the service throws UnauthorizedError("errors:mfaNotEnabled")
      expect(response.statusCode).toBe(401);
    });

    // NEGATIVE — empty code string fails validation (400)
    it('should return 400 when code field is empty', async () => {
      const { token } = await createActiveUserWithToken();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: { code: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — missing code field entirely fails validation (400)
    it('should return 400 when code field is missing', async () => {
      const { token } = await createActiveUserWithToken();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — code longer than 6 digits fails DTO validation (400)
    it('should return 400 when code is longer than 6 digits', async () => {
      const { token } = await createActiveUserWithToken();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: { code: '1234567' },
      });

      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — non-numeric code fails DTO regex validation (400)
    it('should return 400 when code contains non-digit characters', async () => {
      const { token } = await createActiveUserWithToken();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        token,
        payload: { code: 'abcdef' },
      });

      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — unauthenticated request to the authenticated MFA verify endpoint
    it('should return 401 when no bearer token is provided to the authenticated verify endpoint', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/mfa/verify'),
        payload: { code: '123456' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/mfa/login (public MFA login completion)', () => {
    // NEGATIVE — missing mfa_session_token returns 400 / 422
    it('should return 400 when mfa_session_token is missing from login body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: { totp_code: '000000' },
      });

      // Missing required field — DTO validation rejects with 400
      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — invalid / expired MFA session token returns 401
    it('should return 401 when mfa_session_token is invalid or expired', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {
          mfa_session_token: 'invalid-mfa-session-token-that-does-not-exist-in-redis',
          totp_code: '000000',
        },
      });

      // Redis key not found → verifyMfaSession throws → 401
      expect(response.statusCode).toBe(401);
    });

    // NEGATIVE — empty body returns 400
    it('should return 400 when the MFA login body is completely empty', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    // NEGATIVE — TOTP code provided with wrong format (not 6 digits) returns 400
    it('should return 400 when totp_code is not a 6-digit string in the login flow', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/mfa/login'),
        payload: {
          mfa_session_token: 'any-token',
          totp_code: 'ABCDEF',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
