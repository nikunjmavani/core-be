import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import { OAUTH_STATE_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';
import { SUPPORTED_OAUTH_PROVIDERS, type OAuthProvider } from './oauth.types.js';
import { generatePkceCodeVerifier } from './oauth-pkce.js';

export { OAUTH_STATE_TTL_SECONDS };
/** Redis key prefix for stored OAuth `state` tokens (CSRF defence on the authorize round-trip). */
export const OAUTH_STATE_KEY_PREFIX = 'oauth:state:';

/** Lower-cases the provider slug (`Google` → `google`) so storage/comparison is case-insensitive. */
export function normalizeOAuthProvider(provider: string): string {
  return provider.toLowerCase();
}

/**
 * Normalises the provider slug and ensures it belongs to
 * {@link SUPPORTED_OAUTH_PROVIDERS}; otherwise throws `NotFoundError` (404) —
 * an unknown provider name is a missing resource, not an unimplemented
 * feature. The 501 `NotImplementedError` is reserved for providers that are
 * in the supported list but lack a configured implementation.
 */
export function assertOAuthProviderSupported(provider: string): OAuthProvider {
  const normalizedProvider = normalizeOAuthProvider(provider);
  if (!SUPPORTED_OAUTH_PROVIDERS.includes(normalizedProvider as OAuthProvider)) {
    throw new NotFoundError('OAuth provider');
  }
  return normalizedProvider as OAuthProvider;
}

/**
 * Payload persisted under `oauth:state:<state>` for the authorize round-trip.
 *
 * @remarks
 * - **Algorithm:** binds the issued `state` to the provider, the PKCE `code_verifier`
 *   (RFC 7636) the token exchange must echo, and the SHA-256 hash of the browser nonce
 *   so the callback can only be completed by the same browser that began the flow.
 * - **Side effects:** none (shape only).
 * - **Notes:** the raw nonce is never stored — only its hash rests in Redis.
 */
interface OAuthStatePayload {
  provider: OAuthProvider;
  code_verifier: string;
  nonce_hash: string;
}

/** SHA-256 hex digest of a browser nonce, so the raw nonce never rests in Redis. */
export function hashOAuthNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/**
 * Result of {@link createOAuthState}: the opaque `state`, the PKCE `codeVerifier` the
 * service derives a challenge from, and the `nonce` the handler must set as a browser cookie.
 */
export interface CreateOAuthStateResult {
  state: string;
  codeVerifier: string;
  nonce: string;
}

/**
 * Mints a single-use OAuth `state` plus the PKCE verifier and browser nonce that harden the
 * authorize round-trip, persisting `{provider, code_verifier, nonce_hash}` in Redis with
 * {@link OAUTH_STATE_TTL_SECONDS} TTL.
 *
 * @remarks
 * - **Algorithm:** generates a 32-byte `state`, an RFC 7636 PKCE `code_verifier`, and a 32-byte
 *   browser `nonce`; stores the provider, the verifier (needed at token exchange), and the nonce
 *   HASH so the callback can require the originating browser's cookie.
 * - **Side effects:** writes one `oauth:state:*` entry to Redis.
 * - **Notes:** the verifier and nonce are returned to the caller and must NOT be persisted
 *   anywhere except (verifier) Redis and (nonce) a short-lived httpOnly cookie.
 */
export async function createOAuthState(
  redis: Redis,
  provider: OAuthProvider,
): Promise<CreateOAuthStateResult> {
  const state = randomBytes(32).toString('hex');
  const codeVerifier = generatePkceCodeVerifier();
  const nonce = randomBytes(32).toString('hex');
  const payload: OAuthStatePayload = {
    provider,
    code_verifier: codeVerifier,
    nonce_hash: hashOAuthNonce(nonce),
  };
  await redis.set(
    `${OAUTH_STATE_KEY_PREFIX}${state}`,
    JSON.stringify(payload),
    'EX',
    OAUTH_STATE_TTL_SECONDS,
  );
  return { state, codeVerifier, nonce };
}

/** Result of a successful {@link consumeOAuthState}: the resolved provider and the PKCE verifier to send at token exchange. */
export interface ConsumeOAuthStateResult {
  provider: OAuthProvider;
  codeVerifier: string;
}

/**
 * Single-use, browser-bound lookup of an OAuth `state` token.
 *
 * @remarks
 * - **Algorithm:** atomically reads-and-deletes the Redis entry (`GETDEL`), parses the JSON
 *   payload, then enforces three checks before returning: the `state` was issued for the same
 *   provider, and the supplied browser `nonce` hashes to the stored `nonce_hash`. Returns the
 *   PKCE `code_verifier` so the caller can complete the RFC 7636 exchange.
 * - **Failure modes:** missing/empty/expired state, malformed payload, provider mismatch, or a
 *   missing/mismatched nonce all throw `UnauthorizedError` (`errors:oauthInvalidState`). The
 *   atomic consume guarantees only one of two concurrent callbacks can read a non-null value,
 *   preventing state replay in a GET-then-DEL race.
 * - **Side effects:** deletes the `oauth:state:*` entry.
 * - **Notes:** the nonce check binds the callback to the browser that initiated authorize,
 *   defeating login-CSRF where an attacker injects their own `state`+`code` pair.
 */
export async function consumeOAuthState(
  redis: Redis,
  provider: string,
  state: string | undefined,
  nonce: string | undefined,
): Promise<ConsumeOAuthStateResult> {
  if (!state || state.length === 0) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  const storedPayloadRaw = await redis.getdel(`${OAUTH_STATE_KEY_PREFIX}${state}`);
  if (!storedPayloadRaw) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(storedPayloadRaw) as OAuthStatePayload;
  } catch {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  const normalizedProvider = normalizeOAuthProvider(provider);
  if (payload.provider !== normalizedProvider) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  if (!nonce || nonce.length === 0 || hashOAuthNonce(nonce) !== payload.nonce_hash) {
    throw new UnauthorizedError('errors:oauthInvalidState');
  }

  return {
    provider: assertOAuthProviderSupported(normalizedProvider),
    codeVerifier: payload.code_verifier,
  };
}
