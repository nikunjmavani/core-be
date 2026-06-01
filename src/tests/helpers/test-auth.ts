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

async function persistActiveSessionForToken(userPublicId: string, token: string): Promise<void> {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.public_id, userPublicId))
    .limit(1);
  if (!user) {
    return;
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_MAX_AGE_DAYS * MILLISECONDS_PER_DAY);
  const sessionRepository = new AuthSessionRepository();
  await sessionRepository.create({
    user_id: user.id,
    token_hash: tokenHash,
    refresh_token_hash: createHash('sha256').update(`${tokenHash}:refresh`).digest('hex'),
    ip_address: '127.0.0.1',
    user_agent: 'vitest',
    expires_at: expiresAt,
  });
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
 */
export async function generateTestTokenWithActiveSession(
  application: FastifyInstance,
  userPublicId: string,
  options?: { role?: string },
): Promise<string> {
  const token = await signAccessToken({
    userId: userPublicId,
    role: options?.role ?? 'user',
  });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_MAX_AGE_DAYS * MILLISECONDS_PER_DAY);
  await application.authDomain.authSessionService.createSessionForUser(userPublicId, {
    token_hash: tokenHash,
    ip_address: '127.0.0.1',
    expires_at: expiresAt,
  });
  return token;
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
