import { randomUUID } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, importPKCS8, importSPKI } from 'jose';
import type { CryptoKey } from 'jose';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@/shared/constants/index.js';
import { JWT_ISSUER } from '@/shared/constants/project-identity.constants.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';
import { getEnv } from '@/shared/config/env.config.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const JWT_AUDIENCE = 'core-api';
const JWT_ALGORITHM = 'RS256';

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

/**
 * Eagerly imports the configured RS256 key material — the signing key and the verification key — so
 * a malformed or placeholder PEM fails fast at startup instead of at the first sign/verify (i.e. the
 * first login after deploy).
 *
 * @remarks
 * - **Algorithm:** delegates to the same lazy `importPKCS8`/`importSPKI` loaders used at runtime,
 *   so the validation is byte-for-byte identical to actual signing/verification. Imported keys are
 *   cached, making this safe and cheap to call repeatedly.
 * - **Failure modes:** throws a wrapped `Error` describing which key material is invalid when a PEM
 *   cannot be parsed.
 * - **Side effects:** populates the module-level key caches.
 */
export async function assertJwtKeyMaterial(): Promise<void> {
  try {
    await getSigningKey();
    await getVerifyKey();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`JWT key material is invalid or unparseable: ${detail}`);
  }
}

/** Decoded access-token claims relevant to the application (subject + optional global role). */
export interface TokenPayload {
  userId: string;
  role?: string;
  /**
   * Active organization (`org_…` public id) the token is scoped to — the tenant context for
   * this request. Absent when the user has no active organization (team-only mode, no team yet).
   * A signed claim, so it cannot be tampered; membership + RLS are still re-checked per request.
   */
  organizationPublicId?: string;
  /**
   * Session version — RESERVED, not yet enforced. The signer/verifier carry it end-to-end, but no
   * caller currently mints a value and no request path compares it, so it is dropped from the JWT
   * via `omitUndefined`. Token revocation today is enforced by the server-side session token-hash
   * path (`verifyActiveAccessToken` → `findActiveByTokenHash` + cache invalidation on logout /
   * "sign out everywhere" / refresh-reuse). This claim is forward-looking plumbing for a future
   * stateless second factor; do not assume it is checked per request.
   */
  sessionVersion?: number;
}

/**
 * Sign an access token with RS256.
 * - 15-minute expiry (or shorter for global admin)
 * - No email in payload (security: avoid leaking PII)
 * - iss/aud claims set for validation
 * - `org` carries the active organization (tenant scope); `sv` the session version.
 */
export async function signAccessToken(payload: {
  userId: string;
  role?: string | undefined;
  organizationPublicId?: string | undefined;
  sessionVersion?: number | undefined;
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

  const builder = new SignJWT(
    omitUndefined({ role, org: payload.organizationPublicId, sv: payload.sessionVersion }),
  )
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
 * Resolves the RS256 verification key for a token after enforcing the RS256-only algorithm guard.
 *
 * @remarks
 * Single-key model: every token is verified against the one configured `JWT_PUBLIC_KEY`. The `kid`
 * header is stamped on sign (`JWT_SIGNING_KID`) for standard/forward-compatible token shape but is
 * NOT used to select a key — there is no keyring.
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
  if (typeof payload.role === 'string') {
    tokenPayload.role = payload.role;
  }
  if (typeof payload.org === 'string') {
    tokenPayload.organizationPublicId = payload.org;
  }
  if (typeof payload.sv === 'number') {
    tokenPayload.sessionVersion = payload.sv;
  }
  return tokenPayload;
}

/** Test-only reset — avoids bleed between Vitest cases that change JWT env. */
export function resetJwtCachesForTests(): void {
  _signingKey = null;
  _verifyKey = null;
}

export { JWT_ISSUER, JWT_AUDIENCE, ACCESS_TOKEN_EXPIRY_SECONDS };
