import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestTokenWithActiveSession } from '@/tests/helpers/test-auth.js';
import { seedRecentStepUpForTestUser } from '@/tests/helpers/test-step-up.helper.js';
import type { FastifyInstance } from 'fastify';

describe('Auth WebAuthn — Integration', () => {
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
  });

  describe('POST /api/v1/auth/me/webauthn/register/options', () => {
    it('should return registration options for authenticated user', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenWithActiveSession(
        app,
        user.public_id,
      );
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/webauthn/register/options'),
        token,
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        data: { options: { challenge: string }; challenge_token: string };
      };
      expect(body.data.options.challenge).toBeTruthy();
      expect(body.data.challenge_token).toBeTruthy();
    });

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/webauthn/register/options'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/me/webauthn/register/verify', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/webauthn/register/verify'),
        payload: { challenge_token: 'a'.repeat(64), response: { id: 'x', type: 'public-key' } },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for invalid body', async () => {
      const user = await createTestUser();
      const { token } = await generateTestTokenWithActiveSession(app, user.public_id);
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/me/webauthn/register/verify'),
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('GET /api/v1/auth/me/webauthn/credentials', () => {
    it('returns an empty list for an authenticated user with no passkeys', async () => {
      const user = await createTestUser();
      const { token } = await generateTestTokenWithActiveSession(app, user.public_id);

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/webauthn/credentials'),
        token,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/auth/me/webauthn/credentials'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/auth/me/webauthn/credentials/:credential_id', () => {
    const validCredentialId = 'wac_a1b2c3d4e5f6g7h8i9j0k';

    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/webauthn/credentials/${validCredentialId}`),
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when recent step-up is missing', async () => {
      const user = await createTestUser();
      const { token } = await generateTestTokenWithActiveSession(app, user.public_id);

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/webauthn/credentials/${validCredentialId}`),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 for a malformed credential id (before any lookup)', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenWithActiveSession(
        app,
        user.public_id,
      );
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/auth/me/webauthn/credentials/not-a-public-id'),
        token,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for a well-formed but unknown passkey id (with step-up)', async () => {
      const user = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenWithActiveSession(
        app,
        user.public_id,
      );
      await seedRecentStepUpForTestUser(user.public_id, sessionPublicId);

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/webauthn/credentials/${validCredentialId}`),
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/auth/webauthn/authenticate/options', () => {
    it('should return 400 when email is omitted (anti-enumeration)', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/authenticate/options'),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/auth/webauthn/authenticate/verify', () => {
    it('should return 400 for invalid body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/authenticate/verify'),
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('does not mint a session for a schema-valid but forged assertion', async () => {
      // Black-box guard for the public, unauthenticated passkey login endpoint. The body below
      // passes DTO validation (so the request reaches the service) but carries a fabricated
      // challenge token and bogus assertion. The ceremony must fail and — critically — no session
      // cookie or access/refresh token may be issued for any user. A wiring regression that trusted
      // client input here would be a full account-takeover primitive, and the @simplewebauthn
      // verifier is mocked in the unit suite, so this end-to-end no-session-mint check is the guard.
      const base64Url = 'AAAA';
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/webauthn/authenticate/verify'),
        payload: {
          challenge_token: 'f'.repeat(64),
          response: {
            id: base64Url,
            rawId: base64Url,
            response: {
              clientDataJSON: base64Url,
              authenticatorData: base64Url,
              signature: base64Url,
              userHandle: base64Url,
            },
            type: 'public-key',
          },
        },
      });

      // A clean rejection (never a 201 success, never a 5xx crash) ...
      expect(response.statusCode).not.toBe(201);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      // ... and no session / tokens minted regardless of the rejection status.
      expect(response.cookies.session_id).toBeUndefined();
      const body = response.json() as {
        data?: { access_token?: string; refresh_token?: string };
      };
      expect(body?.data?.access_token).toBeUndefined();
      expect(body?.data?.refresh_token).toBeUndefined();
    });
  });
});
