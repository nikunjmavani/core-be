import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '@/shared/config/env.config.js';
import { MILLISECONDS_PER_DAY } from '@/shared/constants/index.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { AuthSessionRepository } from '@/domains/auth/sub-domains/auth-session/auth-session.repository.js';
import { database } from '@/infrastructure/database/connection.js';
import { users } from '@/domains/user/user.schema.js';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';

async function persistActiveSessionForToken(
  userPublicId: string,
  token: string,
): Promise<string | null> {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.public_id, userPublicId))
    .limit(1);
  if (!user) {
    return null;
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_MAX_AGE_DAYS * MILLISECONDS_PER_DAY);
  const sessionRepository = new AuthSessionRepository();
  const session = await sessionRepository.create({
    user_id: user.id,
    token_hash: tokenHash,
    refresh_token_hash: createHash('sha256').update(`${tokenHash}:refresh`).digest('hex'),
    ip_address: '127.0.0.1',
    user_agent: 'vitest',
    expires_at: expiresAt,
  });
  return session.public_id;
}

/**
 * Generate a test JWT access token backed by an active auth session row (required by auth middleware).
 */
export async function generateTestToken(options: {
  userId: string;
  role?: string;
}): Promise<string> {
  const token = await signAccessToken({
    userId: options.userId,
    role: options.role ?? 'user',
  });
  await persistActiveSessionForToken(options.userId, token);
  return token;
}

/**
 * Variant of {@link generateTestToken} that also returns the resulting session's `public_id`.
 *
 * @remarks Use this when a test needs to call `seedRecentStepUpForTestUser(userId, sessionId)`
 * because the step-up sentinel is per-(user, session) after sec-A2. Tests that only need the
 * bearer can keep using `generateTestToken`.
 */
export async function generateTestTokenAndSession(options: {
  userId: string;
  role?: string;
}): Promise<{ token: string; sessionPublicId: string }> {
  const token = await signAccessToken({
    userId: options.userId,
    role: options.role ?? 'user',
  });
  const sessionPublicId = await persistActiveSessionForToken(options.userId, token);
  if (!sessionPublicId) {
    throw new Error(
      `generateTestTokenAndSession could not persist a session for user ${options.userId}`,
    );
  }
  return { token, sessionPublicId };
}

/**
 * Generate a test token for a super admin user.
 */
export async function generateSuperAdminToken(userId = 'test-super-admin'): Promise<string> {
  return generateTestToken({ userId, role: 'super_admin' });
}

/**
 * Generate a test token for a regular user.
 */
export async function generateUserToken(userId = 'test-user'): Promise<string> {
  return generateTestToken({ userId, role: 'user' });
}

/**
 * Issue a JWT and persist a matching active session row (required by auth middleware).
 *
 * @remarks Returns both the bearer token and the resulting session `public_id`. Tests that
 * need to seed a recent step-up must pass the session id to `seedRecentStepUpForTestUser`
 * because the sentinel is per-(user, session) after sec-A2.
 */
export async function generateTestTokenWithActiveSession(
  application: FastifyInstance,
  userPublicId: string,
  options?: { role?: string },
): Promise<{ token: string; sessionPublicId: string }> {
  const token = await signAccessToken({
    userId: userPublicId,
    role: options?.role ?? 'user',
  });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_MAX_AGE_DAYS * MILLISECONDS_PER_DAY);
  const session = await application.authDomain.authSessionService.createSessionForUser(
    userPublicId,
    {
      token_hash: tokenHash,
      ip_address: '127.0.0.1',
      expires_at: expiresAt,
    },
  );
  return { token, sessionPublicId: session.public_id };
}

/**
 * Log in via the API and return a bearer token backed by an active auth session row.
 */
export async function loginAndGetAccessToken(
  application: FastifyInstance,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await injectUnauthenticated(application, {
    method: 'POST',
    url: testApiPath('/auth/login'),
    payload: credentials,
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed with status ${response.statusCode}: ${response.body}`);
  }
  const body = response.json() as { data: { access_token: string } };
  return body.data.access_token;
}
