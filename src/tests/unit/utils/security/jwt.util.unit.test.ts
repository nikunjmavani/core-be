import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, importPKCS8 } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import * as envConfigModule from '@/shared/config/env.config.js';
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

  describe('RS256 single-key verify', () => {
    const keyPairA = generateRsaPemKeyPair();
    const keyPairB = generateRsaPemKeyPair();

    beforeEach(() => {
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-a';
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    afterEach(() => {
      delete process.env.JWT_SIGNING_KID;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    it('includes kid in the protected header when signing with RS256', async () => {
      const token = await signAccessToken({ userId: 'user-rs256' });
      const header = decodeProtectedHeader(token);
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe('key-a');
    });

    it('verifies with the configured public key', async () => {
      const token = await signAccessToken({ userId: 'user-rs256-verify' });
      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-rs256-verify');
    });

    it('rejects when JWT_PUBLIC_KEY is replaced by a different keypair', async () => {
      const token = await signAccessToken({ userId: 'user-mismatched-key' });
      process.env.JWT_PUBLIC_KEY = keyPairB.publicKey;
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('kid-indexed verify keyring (JWT_PUBLIC_KEYS)', () => {
    const keyPairA = generateRsaPemKeyPair();
    const keyPairB = generateRsaPemKeyPair();

    afterEach(() => {
      delete process.env.JWT_PUBLIC_KEYS;
      delete process.env.JWT_SIGNING_KID;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    it('verifies a token signed under kid A against the keyring', async () => {
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-a';
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({
        'key-a': keyPairA.publicKey,
        'key-b': keyPairB.publicKey,
      });
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const token = await signAccessToken({ userId: 'user-kid-a' });
      expect(decodeProtectedHeader(token).kid).toBe('key-a');
      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-kid-a');
    });

    it('still verifies old-kid tokens after rotating the signing kid (overlap window)', async () => {
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-a';
      resetEnvCacheForTests();
      resetJwtCachesForTests();
      const oldToken = await signAccessToken({ userId: 'user-old' });

      process.env.JWT_PRIVATE_KEY = keyPairB.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairB.publicKey;
      process.env.JWT_SIGNING_KID = 'key-b';
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({
        'key-a': keyPairA.publicKey,
        'key-b': keyPairB.publicKey,
      });
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const newToken = await signAccessToken({ userId: 'user-new' });
      expect(decodeProtectedHeader(newToken).kid).toBe('key-b');
      expect((await verifyAccessToken(newToken)).userId).toBe('user-new');
      expect((await verifyAccessToken(oldToken)).userId).toBe('user-old');
    });

    it('rejects a token whose kid is present but not in the active keyring (no silent fallback)', async () => {
      // Signing with key-a (kid=key-a) but the keyring only knows key-b — this must be
      // rejected hard so retired keys cannot verify against JWT_PUBLIC_KEY after rotation.
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-a';
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({ 'key-b': keyPairB.publicKey });
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const token = await signAccessToken({ userId: 'user-retired-key' });
      await expect(verifyAccessToken(token)).rejects.toThrow(
        "JWT kid 'key-a' is not present in the active key rotation ring",
      );
    });

    it('rejects a token whose kid maps to a non-matching keyring entry', async () => {
      process.env.JWT_PRIVATE_KEY = keyPairA.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPairA.publicKey;
      process.env.JWT_SIGNING_KID = 'key-b';
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({
        'key-a': keyPairA.publicKey,
        'key-b': keyPairB.publicKey,
      });
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const token = await signAccessToken({ userId: 'user-wrong-kid' });
      await expect(verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('algorithm-confusion and claim validation', () => {
    const keyPair = generateRsaPemKeyPair();
    const now = Math.floor(Date.now() / 1000);
    let signingKey: CryptoKey;

    beforeEach(async () => {
      process.env.JWT_PRIVATE_KEY = keyPair.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPair.publicKey;
      delete process.env.JWT_SIGNING_KID;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
      signingKey = await importPKCS8(keyPair.privateKey, 'RS256');
    });

    it('rejects tokens signed with alg=none (unsigned token)', async () => {
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
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('user-wrong-iss')
        .setIssuer('attacker.example')
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(signingKey);

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token with wrong audience', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('user-wrong-aud')
        .setIssuer(JWT_ISSUER)
        .setAudience('not-our-api')
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(signingKey);

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token missing subject', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(signingKey);

      await expect(verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('JWT_LEGACY_KEY_ENABLED sunset gate', () => {
    const keyPair = generateRsaPemKeyPair();
    const now = Math.floor(Date.now() / 1000);
    let signingKey: CryptoKey;

    beforeEach(async () => {
      process.env.JWT_PRIVATE_KEY = keyPair.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPair.publicKey;
      delete process.env.JWT_SIGNING_KID;
      delete process.env.JWT_PUBLIC_KEYS;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
      signingKey = await importPKCS8(keyPair.privateKey, 'RS256');
    });

    afterEach(() => {
      delete process.env.JWT_LEGACY_KEY_ENABLED;
      delete process.env.JWT_SIGNING_KID;
      delete process.env.JWT_PUBLIC_KEYS;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    async function signKidlessToken(userId: string): Promise<string> {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(userId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(signingKey);
    }

    it('accepts a kid-less token when JWT_LEGACY_KEY_ENABLED defaults to true', async () => {
      const token = await signKidlessToken('user-kidless-default');
      expect(decodeProtectedHeader(token).kid).toBeUndefined();

      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-kidless-default');
    });

    it('rejects a kid-less token when JWT_LEGACY_KEY_ENABLED=false (sunset)', async () => {
      process.env.JWT_LEGACY_KEY_ENABLED = 'false';
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const token = await signKidlessToken('user-kidless-rejected');
      await expect(verifyAccessToken(token)).rejects.toThrow(
        /legacy kid-less verification disabled/,
      );
    });

    it('still accepts kid-bearing tokens via the keyring when JWT_LEGACY_KEY_ENABLED=false', async () => {
      process.env.JWT_LEGACY_KEY_ENABLED = 'false';
      process.env.JWT_SIGNING_KID = 'key-a';
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({ 'key-a': keyPair.publicKey });
      resetEnvCacheForTests();
      resetJwtCachesForTests();

      const token = await signAccessToken({ userId: 'user-kid-accepted-after-sunset' });
      expect(decodeProtectedHeader(token).kid).toBe('key-a');
      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-kid-accepted-after-sunset');
    });
  });

  describe('RS256-only policy', () => {
    const sharedSecret = 'test-jwt-secret-min-32-chars-xxxxxxxx';
    const keyPair = generateRsaPemKeyPair();
    const now = Math.floor(Date.now() / 1000);

    beforeEach(() => {
      process.env.JWT_PRIVATE_KEY = keyPair.privateKey;
      process.env.JWT_PUBLIC_KEY = keyPair.publicKey;
      resetEnvCacheForTests();
      resetJwtCachesForTests();
    });

    it('rejects an HS256 token at verify time', async () => {
      const { TextEncoder } = await import('node:util');
      const hsToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-hs256')
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(new TextEncoder().encode(sharedSecret));

      await expect(verifyAccessToken(hsToken)).rejects.toThrow(/RS256 only/);
    });

    it('signs and verifies RS256 tokens', async () => {
      const token = await signAccessToken({ userId: 'user-rs256-only' });
      expect(decodeProtectedHeader(token).alg).toBe('RS256');
      const payload = await verifyAccessToken(token);
      expect(payload.userId).toBe('user-rs256-only');
    });

    it('refuses to sign when JWT_PRIVATE_KEY is unset', async () => {
      const baseEnv = envConfigModule.getEnv();
      const getEnvSpy = vi.spyOn(envConfigModule, 'getEnv').mockReturnValue({
        ...baseEnv,
        JWT_PRIVATE_KEY: '',
      });
      resetJwtCachesForTests();

      await expect(signAccessToken({ userId: 'user-no-key' })).rejects.toThrow(
        /JWT_PRIVATE_KEY is required/,
      );

      getEnvSpy.mockRestore();
    });
  });
});
