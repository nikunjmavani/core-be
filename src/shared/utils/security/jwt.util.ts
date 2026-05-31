import { randomUUID } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { CryptoKey } from 'jose';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/index.js';
import { JWT_ISSUER } from '@/shared/constants/project-identity.constants.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';
import { getEnv } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const JWT_AUDIENCE = 'core-api';
const JWT_ALGORITHM = 'RS256' as const;

let _signingKey: CryptoKey | null = null;
let _verifyKey: CryptoKey | null = null;
let _verifyKeyring: Map<string, CryptoKey> | null = null;
let _verifyKeyringLoaded = false;

function normalizePem(value: string): string {
  const normalized = value.replaceAll('\\n', '\n').trim();
  const beginIndex = normalized.indexOf('-----BEGIN ');
  return beginIndex > 0 ? normalized.slice(beginIndex) : normalized;
}

/**
 * Lazily parses the optional `JWT_PUBLIC_KEYS` JSON map into a `kid`→public-key keyring.
 * Returns `null` when the map is unset/empty so verification falls back to the single
 * `JWT_PUBLIC_KEY`, preserving the pre-keyring behaviour byte-for-byte.
 */
async function getVerifyKeyring(): Promise<Map<string, CryptoKey> | null> {
  if (_verifyKeyringLoaded) {
    return _verifyKeyring;
  }

  _verifyKeyringLoaded = true;
  const raw = getEnv().JWT_PUBLIC_KEYS;
  if (!raw || raw.trim().length === 0) {
    _verifyKeyring = null;
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('JWT_PUBLIC_KEYS must be a JSON object mapping kid to PEM public key');
  }

  const keyring = new Map<string, CryptoKey>();
  for (const [kid, pem] of Object.entries(parsed)) {
    if (typeof pem !== 'string' || pem.trim().length === 0) {
      continue;
    }
    keyring.set(kid, await importSPKI(normalizePem(pem), JWT_ALGORITHM));
  }

  _verifyKeyring = keyring.size > 0 ? keyring : null;
  return _verifyKeyring;
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

/**
 * Eagerly imports the configured RS256 key material — the signing key, the verification key,
 * and the optional `JWT_PUBLIC_KEYS` rotation keyring — so a malformed or placeholder PEM fails
 * fast at startup instead of at the first sign/verify (i.e. the first login after deploy).
 *
 * @remarks
 * - **Algorithm:** delegates to the same lazy `importPKCS8`/`importSPKI` loaders used at runtime,
 *   so the validation is byte-for-byte identical to actual signing/verification. Imported keys are
 *   cached, making this safe and cheap to call repeatedly.
 * - **Failure modes:** throws a wrapped `Error` describing which key material is invalid when a PEM
 *   cannot be parsed or the keyring JSON is malformed.
 * - **Side effects:** populates the module-level key caches.
 */
export async function assertJwtKeyMaterial(): Promise<void> {
  try {
    await getSigningKey();
    await getVerifyKey();
    await getVerifyKeyring();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`JWT key material is invalid or unparseable: ${detail}`);
  }
}

/** Decoded access-token claims relevant to the application (subject + optional global role). */
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

  const keyring = await getVerifyKeyring();
  if (keyring && typeof header.kid === 'string') {
    const keyForKid = keyring.get(header.kid);
    if (keyForKid) {
      return { key: keyForKid, algorithm: JWT_ALGORITHM };
    }
  }

  return getVerifyKey();
}

/**
 * Verifies an access token's signature, algorithm (RS256 only), issuer,
 * audience, and expiration; returns the decoded {@link TokenPayload}. Throws
 * for any failure path so callers can surface a 401.
 */
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
  _verifyKeyring = null;
  _verifyKeyringLoaded = false;
}

export { JWT_ISSUER, JWT_AUDIENCE, ACCESS_TOKEN_EXPIRY_SECONDS };
