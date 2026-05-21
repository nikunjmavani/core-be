import { generateKeyPairSync } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { SignJWT, decodeProtectedHeader } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  resetJwtCachesForTests,
  signAccessToken,
  verifyAccessToken,
} from '@/shared/utils/security/jwt.util.js';

function generateRsaPemKeyPair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('jwt.util', () => {
  it('exports issuer, audience, and expiry constants', () => {
    expect(JWT_ISSUER).toBe('core-be');
    expect(JWT_AUDIENCE).toBe('core-api');
    expect(ACCESS_TOKEN_EXPIRY_SECONDS).toBe(900);
  });

  it('signs and verifies an access token with user id and role', async () => {
    const token = await signAccessToken({ userId: 'user-public-id-123', role: 'user' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyAccessToken(token);
    expect(payload.userId).toBe('user-public-id-123');
    expect(payload.role).toBe('user');
  });

  it('verifies token without role when role omitted at sign time', async () => {
    const token = await signAccessToken({ userId: 'user-no-role' });
    const payload = await verifyAccessToken(token);
    expect(payload.userId).toBe('user-no-role');
    expect(payload.role).toBeUndefined();
  });

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken({ userId: 'user-1' });
    const tampered = `${token.slice(0, -4)}xxxx`;
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await signAccessToken({ userId: 'user-1' });
    const parts = token.split('.');
    await expect(verifyAccessToken(`${parts[0]}.${parts[1]}.invalid-signature`)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    vi.useFakeTimers();
    const token = await signAccessToken({ userId: 'user-expired' });
    vi.advanceTimersByTime((ACCESS_TOKEN_EXPIRY_SECONDS + 1) * 1000);
    await expect(verifyAccessToken(token)).rejects.toThrow();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('RS256 kid and multi-key verify', () => {
    const keyPairA = generateRsaPemKeyPair();
    const keyPairB = generateRsaPemKeyPair();

    beforeEach(() => {
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-a';
      delete process.env.JWT_PUBLIC_KEYS;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    afterEach(() => {
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_SIGNING_KID;
      delete process.env.JWT_PUBLIC_KEYS;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    it('includes kid in the protected header when signing with RS256', async () => {
      const token = await signAccessToken({ userId: 'user-rs256' });
      const header = decodeProtectedHeader(token);
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe('key-a');
    });

    it('verifies with the matching public key for kid', async () => {
      const token = await signAccessToken({ userId: 'user-rs256-verify' });
      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-rs256-verify');
    });

    it('verifies during rotation when an older kid remains in JWT_PUBLIC_KEYS', async () => {
      const token = await signAccessToken({ userId: 'user-rotation' });
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({
        'key-a': keyPairA.publicKey,
        'key-b': keyPairB.publicKey,
      });
      delete process.env.JWT_PUBLIC_KEY;
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-rotation');
    });

    it('rejects when no configured public key matches the token', async () => {
      const token = await signAccessToken({ userId: 'user-no-key' });
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({
        'key-b': keyPairB.publicKey,
      });
      delete process.env.JWT_PUBLIC_KEY;
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('algorithm-confusion and claim validation', () => {
    const sharedSecret = 'test-jwt-secret-min-32-chars-xxxxxxxx';
    const encoder = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);

    beforeEach(() => {
      process.env.JWT_SECRET = sharedSecret;
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_SIGNING_KID;
      delete process.env.JWT_PUBLIC_KEYS;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    it('rejects tokens signed with alg=none (unsigned token)', async () => {
      // Unsigned JWT with `alg: none` and valid claims
      const headerSegment = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      const payloadSegment = Buffer.from(
        JSON.stringify({
          sub: 'user-none-alg',
          iss: JWT_ISSUER,
          aud: JWT_AUDIENCE,
          iat: now,
          exp: now + 60,
        }),
      ).toString('base64url');
      const noneToken = `${headerSegment}.${payloadSegment}.`;

      await expect(verifyAccessToken(noneToken)).rejects.toThrow();
    });

    it('rejects token with wrong issuer', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-wrong-iss')
        .setIssuer('attacker.example')
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(encoder.encode(sharedSecret));

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token with wrong audience', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-wrong-aud')
        .setIssuer(JWT_ISSUER)
        .setAudience('not-our-api')
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(encoder.encode(sharedSecret));

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token missing subject', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(encoder.encode(sharedSecret));

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });
  });
});
