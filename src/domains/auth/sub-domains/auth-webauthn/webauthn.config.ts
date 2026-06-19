import { env } from '@/shared/config/env.config.js';
import { ForbiddenError } from '@/shared/errors/index.js';
import { WEBAUTHN_RP_NAME_DEFAULT } from '@/shared/constants/project-identity.constants.js';
import { parseAllowedOriginsList } from '@/shared/utils/security/allowed-origins.util.js';

/**
 * Conventional local-development WebAuthn origin, used only when the RP id resolves to
 * `localhost` and neither `ALLOWED_ORIGINS` nor `FRONTEND_URL` is configured. Matches the
 * default Next.js/Vite dev port; set `FRONTEND_URL` (or `ALLOWED_ORIGINS`) to override.
 */
const WEBAUTHN_LOCALHOST_ORIGIN_DEFAULT = 'http://localhost:3000';

/**
 * Resolves the local-development WebAuthn origin from configuration instead of a hardcoded port:
 * prefers the `FRONTEND_URL` origin so a dev frontend on a non-3000 port still passes the
 * phishing-origin check, and falls back to {@link WEBAUTHN_LOCALHOST_ORIGIN_DEFAULT} when
 * `FRONTEND_URL` is unset or unparseable.
 */
function resolveLocalDevelopmentWebauthnOrigin(): string {
  if (env.FRONTEND_URL) {
    try {
      return new URL(env.FRONTEND_URL).origin;
    } catch {
      // Unparseable FRONTEND_URL — fall back to the conventional dev origin below.
    }
  }
  return WEBAUTHN_LOCALHOST_ORIGIN_DEFAULT;
}

/** Resolves the WebAuthn Relying Party ID: prefers `WEBAUTHN_RP_ID`, falls back to the first parseable hostname in `ALLOWED_ORIGINS`, then `localhost`. */
export function resolveWebauthnRelyingPartyId(): string {
  if (env.WEBAUTHN_RP_ID && env.WEBAUTHN_RP_ID.length > 0) {
    return env.WEBAUTHN_RP_ID;
  }
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [];
  for (const origin of allowedOrigins) {
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.length > 0) {
        return hostname;
      }
    } catch {
      // ignore invalid entries
    }
  }
  return 'localhost';
}

/** Resolves the user-visible Relying Party name shown by the authenticator: `WEBAUTHN_RP_NAME` when set, otherwise the literal `'core-be'`. */
export function resolveWebauthnRelyingPartyName(): string {
  return env.WEBAUTHN_RP_NAME && env.WEBAUTHN_RP_NAME.length > 0
    ? env.WEBAUTHN_RP_NAME
    : WEBAUTHN_RP_NAME_DEFAULT;
}

/**
 * Resolves the expected origin(s) used by `simplewebauthn` verification, trusting only
 * server-configured origins so a caller cannot dictate the phishing-origin check.
 *
 * @remarks
 * - **Algorithm:** reuses the canonical CORS allowlist ({@link parseAllowedOriginsList} over
 *   `ALLOWED_ORIGINS`). When a request `Origin` header is present it is accepted only if it
 *   EXACTLY matches an allowlisted origin (returned as the single expected origin). When the
 *   request origin is absent — a legitimate non-browser flow — verification falls back to the
 *   configured allowlist itself (a single origin when only one is configured, otherwise the full
 *   array), never a caller-supplied value. Only when no allowlist is configured (dev/test, since
 *   the CORS middleware refuses to boot otherwise) does it synthesise an origin: for a `localhost`
 *   RP id it derives from `FRONTEND_URL` (falling back to the conventional dev port), otherwise
 *   `https://<rpId>`.
 * - **Failure modes:** a present-but-non-allowlisted request origin throws {@link ForbiddenError}
 *   (`errors:originNotAllowed`) BEFORE any credential verification, defeating spoofed `Origin`
 *   headers from non-browser clients.
 * - **Side effects:** none (pure read of `env.ALLOWED_ORIGINS`).
 * - **Notes:** the same validated value is used by both registration and authentication
 *   verification so the trusted-origin policy is identical across enrollment and login.
 */
export function resolveWebauthnExpectedOrigin(requestOrigin?: string): string | string[] {
  const allowedOrigins = parseAllowedOriginsList(env.ALLOWED_ORIGINS);

  if (allowedOrigins.length === 0) {
    const relyingPartyId = resolveWebauthnRelyingPartyId();
    return relyingPartyId === 'localhost'
      ? resolveLocalDevelopmentWebauthnOrigin()
      : `https://${relyingPartyId}`;
  }

  if (requestOrigin && requestOrigin.length > 0) {
    if (!allowedOrigins.includes(requestOrigin)) {
      throw new ForbiddenError('errors:originNotAllowed');
    }
    return requestOrigin;
  }

  const [firstOrigin] = allowedOrigins;
  return allowedOrigins.length === 1 && firstOrigin ? firstOrigin : allowedOrigins;
}
