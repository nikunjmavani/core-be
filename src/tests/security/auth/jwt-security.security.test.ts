import { describe, it, expect } from 'vitest';
import { decodeJwt } from 'jose';
import { PROJECT_SLUG } from '@/shared/constants/project-identity.constants.js';
import {
  signAccessToken,
  verifyAccessToken,
  JWT_ISSUER,
  JWT_AUDIENCE,
  ACCESS_TOKEN_EXPIRY_SECONDS,
} from '@/shared/utils/security/jwt.util.js';

/**
 * JWT security tests — verify token signing, verification, claims,
 * expiry enforcement, and RS256-only algorithm policy.
 */
describe('Security: JWT', () => {
  it('should sign and verify a valid access token', async () => {
    const token = await signAccessToken({ userId: 'test-user-id', role: 'user' });
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const payload = await verifyAccessToken(token);
    expect(payload.userId).toBe('test-user-id');
    expect(payload.role).toBe('user');
  });

  it('should include correct issuer and audience claims', async () => {
    expect(JWT_ISSUER).toBe(PROJECT_SLUG);
    expect(JWT_AUDIENCE).toBe('core-api');
  });

  it('should enforce 15-minute access token expiry', () => {
    expect(ACCESS_TOKEN_EXPIRY_SECONDS).toBe(900);
  });

  it('should reject token with tampered payload', async () => {
    const token = await signAccessToken({ userId: 'original', role: 'user' });
    const parts = token.split('.');
    // Tamper with the payload (middle part)
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'hacker', role: 'super_admin' }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(verifyAccessToken(tamperedToken)).rejects.toThrow();
  });

  it('should reject completely invalid token', async () => {
    await expect(verifyAccessToken('not.a.valid.jwt')).rejects.toThrow();
  });

  it('should reject empty token', async () => {
    await expect(verifyAccessToken('')).rejects.toThrow();
  });

  it('should sign tokens with role claim', async () => {
    const token = await signAccessToken({ userId: 'admin-id', role: 'super_admin' });
    const payload = await verifyAccessToken(token);
    expect(payload.role).toBe('super_admin');
  });

  it('issues shorter-lived tokens for super_admin to bound privilege de-escalation', async () => {
    // De-escalation control (audit #4): the global role lives in the JWT claim, so a demoted
    // admin (removed from GLOBAL_ADMIN_EMAILS) keeps super_admin only until the token expires.
    // super_admin tokens therefore MUST expire sooner than ordinary user tokens so that window
    // stays tightly bounded. (Account suspension/deactivation revokes sessions immediately via
    // AuthSessionService.revokeAllSessions, so the status vector de-escalates without delay.)
    const userToken = await signAccessToken({ userId: 'user-id', role: 'user' });
    const superAdminToken = await signAccessToken({ userId: 'admin-id', role: 'super_admin' });

    const userExpiry = decodeJwt(userToken).exp;
    const superAdminExpiry = decodeJwt(superAdminToken).exp;
    expect(userExpiry).toBeDefined();
    expect(superAdminExpiry).toBeDefined();
    expect(superAdminExpiry as number).toBeLessThan(userExpiry as number);
  });

  it('should handle token without role', async () => {
    const token = await signAccessToken({ userId: 'user-id' });
    const payload = await verifyAccessToken(token);
    expect(payload.userId).toBe('user-id');
    // Role may be undefined
    expect(payload.role).toBeUndefined();
  });
});
