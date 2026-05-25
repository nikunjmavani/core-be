import { randomUUID } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { CryptoKey } from 'jose';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/index.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.js';
import { getEnv } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const JWT_ISSUER = 'core-be';
const JWT_AUDIENCE = 'core-api';
const JWT_ALGORITHM = 'RS256' as const;

let _signingKey: CryptoKey | null = null;
let _verifyKey: CryptoKey | null = null;

function normalizePem(value: string): string {
  const normalized = value.replaceAll('\\n', '\n').trim();
  const beginIndex = normalized.indexOf('-----BEGIN ');
  return beginIndex > 0 ? normalized.slice(beginIndex) : normalized;
}

async function getSigningKey(): Promise<{ key: CryptoKey; algorithm: typeof JWT_ALGORITHM }> {
  if (_signingKey) {
    return { key: _signingKey, algorithm: JWT_ALGORITHM };
  }

  const environment = getEnv();
  const privateKeyPem = environment.JWT_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error('JWT_PRIVATE_KEY is required: RS256 signing is mandatory');
  }

  _signingKey = await importPKCS8(normalizePem(privateKeyPem), JWT_ALGORITHM);
  return { key: _signingKey, algorithm: JWT_ALGORITHM };
}

async function getVerifyKey(): Promise<{ key: CryptoKey; algorithm: typeof JWT_ALGORITHM }> {
  if (_verifyKey) {
    return { key: _verifyKey, algorithm: JWT_ALGORITHM };
  }

  const environment = getEnv();
  const publicKeyPem = environment.JWT_PUBLIC_KEY;
  if (!publicKeyPem) {
    throw new Error('JWT_PUBLIC_KEY is required: RS256 verification is mandatory');
  }

  _verifyKey = await importSPKI(normalizePem(publicKeyPem), JWT_ALGORITHM);
  return { key: _verifyKey, algorithm: JWT_ALGORITHM };
}

export interface TokenPayload {
  userId: string;
  role?: string;
}

/**
 * Sign an access token with RS256.
 * - 15-minute expiry (or shorter for global admin)
 * - No email in payload (security: avoid leaking PII)
 * - iss/aud claims set for validation
 */
export async function signAccessToken(payload: {
  userId: string;
  role?: string | undefined;
}): Promise<string> {
  const userId = payload.userId;
  const role = payload.role;
  const { key } = await getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const environment = getEnv();
  const expirySeconds =
    role === GLOBAL_ROLES.SUPER_ADMIN
      ? environment.GLOBAL_ADMIN_ACCESS_TOKEN_EXPIRY_SECONDS
      : ACCESS_TOKEN_EXPIRY_SECONDS;

  const builder = new SignJWT(omitUndefined({ role }))
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid: environment.JWT_SIGNING_KID })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expirySeconds);

  return builder.sign(key);
}

/**
 * Verify and decode an access token.
 * Validates: algorithm (RS256 only), issuer, audience, expiration.
 */
async function resolveVerifyKeyForToken(token: string): Promise<{
  key: CryptoKey;
  algorithm: typeof JWT_ALGORITHM;
}> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== JWT_ALGORITHM) {
    throw new Error('JWT algorithm not allowed: RS256 only');
  }
  return getVerifyKey();
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { key, algorithm } = await resolveVerifyKeyForToken(token);
  const { payload } = await jwtVerify(token, key, {
    algorithms: [algorithm],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (!payload.sub) {
    throw new Error('Invalid token: missing subject');
  }

  const tokenPayload: TokenPayload = { userId: payload.sub };
  if (payload.role !== undefined && payload.role !== null) {
    tokenPayload.role = String(payload.role);
  }
  return tokenPayload;
}

/** Test-only reset — avoids bleed between Vitest cases that change JWT env. */
export function resetJwtCachesForTests(): void {
  _signingKey = null;
  _verifyKey = null;
}

export { JWT_ISSUER, JWT_AUDIENCE, ACCESS_TOKEN_EXPIRY_SECONDS };
