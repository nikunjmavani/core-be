import { randomUUID } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { CryptoKey } from 'jose';
import { TextEncoder } from 'node:util';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/index.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.js';
import { getEnv } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const JWT_ISSUER = 'core-be';
const JWT_AUDIENCE = 'core-api';

/**
 * Production must use RS256 only. HS256 remains a development/test convenience (signed with
 * JWT_SECRET). Gating strictly on production prevents algorithm-policy drift: even though the
 * env schema already requires RS256 keys in production, this rejects any HS256 token at verify
 * time and refuses to sign with HS256, so a future schema relaxation cannot silently reintroduce
 * a downgrade path.
 */
function isRsaOnlyAlgorithmRequired(): boolean {
  return getEnv().NODE_ENV === 'production';
}

let _signingKey: CryptoKey | Uint8Array | null = null;
let _verifyKey: CryptoKey | Uint8Array | null = null;
let _algorithm: 'RS256' | 'HS256' = 'HS256';

function normalizePem(value: string): string {
  const normalized = value.replaceAll('\\n', '\n').trim();
  const beginIndex = normalized.indexOf('-----BEGIN ');
  return beginIndex > 0 ? normalized.slice(beginIndex) : normalized;
}

/**
 * Determine the signing key and algorithm.
 * - If JWT_PRIVATE_KEY is set → RS256
 * - Otherwise, falls back to JWT_SECRET → HS256
 */
async function getSigningKey(): Promise<{
  key: CryptoKey | Uint8Array;
  algorithm: 'RS256' | 'HS256';
}> {
  if (_signingKey) {
    return { key: _signingKey, algorithm: _algorithm };
  }

  const environment = getEnv();
  if (environment.JWT_PRIVATE_KEY) {
    _algorithm = 'RS256';
    _signingKey = await importPKCS8(normalizePem(environment.JWT_PRIVATE_KEY), 'RS256');
  } else {
    if (isRsaOnlyAlgorithmRequired()) {
      throw new Error('JWT_PRIVATE_KEY is required in production: RS256 signing is mandatory');
    }
    _algorithm = 'HS256';
    _signingKey = new TextEncoder().encode(environment.JWT_SECRET);
  }
  return { key: _signingKey, algorithm: _algorithm };
}

/**
 * Determine the verification key and algorithm.
 * - If JWT_PUBLIC_KEY is set → RS256
 * - Otherwise, falls back to JWT_SECRET → HS256
 */
async function getVerifyKey(): Promise<{
  key: CryptoKey | Uint8Array;
  algorithm: 'RS256' | 'HS256';
}> {
  if (_verifyKey) {
    return { key: _verifyKey, algorithm: _algorithm };
  }

  const environment = getEnv();
  if (environment.JWT_PUBLIC_KEY) {
    _algorithm = 'RS256';
    _verifyKey = await importSPKI(normalizePem(environment.JWT_PUBLIC_KEY), 'RS256');
  } else {
    _algorithm = 'HS256';
    _verifyKey = new TextEncoder().encode(environment.JWT_SECRET);
  }
  return { key: _verifyKey, algorithm: _algorithm };
}

export interface TokenPayload {
  userId: string;
  role?: string;
}

/**
 * Sign an access token. Uses RS256 in production, HS256 in development.
 * - 15-minute expiry
 * - No email in payload (security: avoid leaking PII)
 * - iss/aud claims set for validation
 */
export async function signAccessToken(payload: {
  userId: string;
  role?: string | undefined;
}): Promise<string> {
  const userId = payload.userId;
  const role = payload.role;
  const { key, algorithm } = await getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const environment = getEnv();
  const expirySeconds =
    role === GLOBAL_ROLES.SUPER_ADMIN
      ? environment.GLOBAL_ADMIN_ACCESS_TOKEN_EXPIRY_SECONDS
      : ACCESS_TOKEN_EXPIRY_SECONDS;

  const protectedHeader: { alg: typeof algorithm; kid?: string } = { alg: algorithm };
  if (algorithm === 'RS256') {
    protectedHeader.kid = environment.JWT_SIGNING_KID;
  }

  const builder = new SignJWT(omitUndefined({ role }))
    .setProtectedHeader(protectedHeader)
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
 * Validates: algorithm, issuer, audience, expiration.
 */
async function resolveVerifyKeyForToken(token: string): Promise<{
  key: CryptoKey | Uint8Array;
  algorithm: 'RS256' | 'HS256';
}> {
  const header = decodeProtectedHeader(token);
  if (isRsaOnlyAlgorithmRequired() && header.alg !== 'RS256') {
    throw new Error('JWT algorithm not allowed: production accepts RS256 only');
  }
  const algorithm = header.alg === 'RS256' ? 'RS256' : 'HS256';

  if (algorithm === 'RS256') {
    const environment = getEnv();
    const publicKeyPem = environment.JWT_PUBLIC_KEY;
    if (!publicKeyPem) {
      throw new Error('No public key configured for JWT verification');
    }
    return {
      key: await importSPKI(publicKeyPem, 'RS256'),
      algorithm: 'RS256',
    };
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
  _algorithm = 'HS256';
}

export { JWT_ISSUER, JWT_AUDIENCE, ACCESS_TOKEN_EXPIRY_SECONDS };
