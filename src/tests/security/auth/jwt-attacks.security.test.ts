import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT, importPKCS8 } from 'jose';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectUnauthenticated,
  injectAuthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

/**
 * JWT forgery / claim-tampering attacks.
 *
 * The access-token verifier pins RS256 (at both the header-decode and jose-verify
 * layers) and validates iss/aud/exp/nbf/sub. These tests are the adversarial
 * regression guard that the defense holds: every forged or tampered token must be
 * rejected (401) on a normal authenticated endpoint, before any session lookup.
 */
const ISSUER = 'core-be';
const AUDIENCE = 'core-api';
const PROTECTED = '/auth/me/sessions';

function normalizePem(value: string): string {
  const normalized = value.replaceAll('\\n', '\n').trim();
  const beginIndex = normalized.indexOf('-----BEGIN ');
  return beginIndex > 0 ? normalized.slice(beginIndex) : normalized;
}

async function serverSigningKey() {
  const pem = process.env.JWT_PRIVATE_KEY;
  if (!pem) throw new Error('JWT_PRIVATE_KEY missing in test env');
  return importPKCS8(normalizePem(pem), 'RS256');
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('Security: JWT forgery / claim tampering', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  async function attack(token: string): Promise<number> {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED),
      headers: { authorization: `Bearer ${token}` },
    });
    return response.statusCode;
  }

  // ─── Positive baseline ──────────────────────────────────────────────────────

  it('baseline: a genuine token is accepted (200)', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(PROTECTED),
      token,
    });
    expect(response.statusCode).toBe(200);
  });

  // ─── Algorithm attacks ──────────────────────────────────────────────────────

  it('rejects an alg=none token (unsigned)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({
      sub: 'attacker',
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 3600,
    });
    const noneToken = `${header}.${payload}.`;
    expect(await attack(noneToken)).toBe(401);
  });

  it('rejects an RS→HS algorithm-confusion token (HS256 signed with the public key)', async () => {
    const publicKeyPem = normalizePem(process.env.JWT_PUBLIC_KEY ?? '');
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    const payload = base64url({
      sub: 'attacker',
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 3600,
    });
    const signature = createHmac('sha256', publicKeyPem)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const hsToken = `${header}.${payload}.${signature}`;
    expect(await attack(hsToken)).toBe(401);
  });

  // ─── Signature / key attacks ────────────────────────────────────────────────

  it('rejects a token signed with a different (attacker) RSA key', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const attackerKey = await importPKCS8(
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      'RS256',
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('attacker')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(attackerKey);
    expect(await attack(token)).toBe(401);
  });

  it('rejects a genuinely-signed token whose kid header was tampered after signing', async () => {
    const key = await serverSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'real' })
      .setSubject('user')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const [, payload, signature] = token.split('.');
    const tamperedHeader = base64url({ alg: 'RS256', kid: 'attacker-controlled' });
    expect(await attack(`${tamperedHeader}.${payload}.${signature}`)).toBe(401);
  });

  // ─── Claim attacks (genuine signature, hostile claims) ──────────────────────

  async function forgeWithServerKey(options: {
    sub?: string | null;
    iss?: string;
    aud?: string;
    expDeltaSeconds?: number;
    nbfDeltaSeconds?: number;
  }): Promise<string> {
    const key = await serverSigningKey();
    const now = Math.floor(Date.now() / 1000);
    let builder = new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(options.iss ?? ISSUER)
      .setAudience(options.aud ?? AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expDeltaSeconds ?? 3600));
    if (options.sub !== null) builder = builder.setSubject(options.sub ?? 'user');
    if (options.nbfDeltaSeconds !== undefined)
      builder = builder.setNotBefore(now + options.nbfDeltaSeconds);
    return builder.sign(key);
  }

  it('rejects an expired token', async () => {
    expect(await attack(await forgeWithServerKey({ expDeltaSeconds: -600 }))).toBe(401);
  });

  it('rejects a token whose nbf is in the future', async () => {
    expect(await attack(await forgeWithServerKey({ nbfDeltaSeconds: 600 }))).toBe(401);
  });

  it('rejects a token with the wrong issuer', async () => {
    expect(await attack(await forgeWithServerKey({ iss: 'evil-issuer' }))).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    expect(await attack(await forgeWithServerKey({ aud: 'evil-audience' }))).toBe(401);
  });

  it('rejects a token with no subject claim', async () => {
    expect(await attack(await forgeWithServerKey({ sub: null }))).toBe(401);
  });

  // ─── Session binding ────────────────────────────────────────────────────────

  it('rejects a genuinely-signed token that has no backing session row', async () => {
    // Valid RS256 signature + correct claims, but signAccessToken-style token was
    // never persisted as a session → the middleware session check must reject it.
    const token = await forgeWithServerKey({ sub: 'ghost-user-public-id' });
    expect(await attack(token)).toBe(401);
  });
});
