# Authentication

core-be supports password login, magic links, OAuth (Google, GitHub), JWT access tokens, session cookies, MFA (TOTP), and organization API keys. Session CSRF and cookie rules are documented in [csrf-and-session-cookies.md](../security/csrf-and-session-cookies.md).

## Current methods

| Method              | Entry routes                            | Notes                                            |
| ------------------- | --------------------------------------- | ------------------------------------------------ |
| Email + password    | `POST /api/v1/auth/login`               | May return MFA challenge                         |
| Magic link          | `POST /api/v1/auth/magic-link/*`        | Passwordless email flow                          |
| OAuth               | `GET /api/v1/auth/oauth/{provider}`     | PKCE + state cookie                              |
| API key             | `Authorization: Bearer` with key prefix | Organization-scoped permissions                  |
| MFA                 | TOTP + recovery codes                   | Encrypted secrets at rest                        |
| WebAuthn / passkeys | `POST /api/v1/auth/webauthn/*`          | FIDO2 credentials in `auth.webauthn_credentials` |

Implementation lives under `src/domains/auth/` (see [sub-domains-layout.md](../architecture/sub-domains-layout.md)).

## Signup and bot abuse (no CAPTCHA vendor)

New accounts are created through:

- **Email/password signup** — `POST /api/v1/auth/signup` (creates the user with `is_email_verified=false`, logs them in immediately, and emails a 6-digit verification code; returns **409** if the email already exists; disposable domains blocked at signup time)
- **Magic link** — `POST /api/v1/auth/magic-link/send` (auto-signs-up an unknown email as a passwordless user, then emails a 6-digit sign-in code; disposable domains blocked at send time)
- **OAuth** — `GET /api/v1/auth/oauth/{provider}/callback` (new users via `completeOAuthUserSession`; disposable domains blocked before `userService.createFromOAuth`)

**Disposable email:** `isDisposableEmailBlocked()` (package `disposable-email-domains-js`) runs on login, magic-link send, password forgot, OAuth user creation, and member invitations. When blocked, the API returns **400** with `errors:disposableEmail`. Toggle with `BLOCK_DISPOSABLE_EMAIL` (default `true`).

**Rate limits:** Public auth routes (`/login`, `/magic-link/*`, `/oauth/*`, password reset, MFA challenge) use `STRICT_PUBLIC_RATE_LIMIT` — **5 requests per minute per IP** in production/staging (`5000` in `NODE_ENV=test` for Vitest). Excess traffic receives **429**.

**CAPTCHA (Cloudflare Turnstile):** When `CAPTCHA_PROVIDER=turnstile` and `CAPTCHA_SECRET` are set, public auth routes require `X-Captcha-Token` from the client widget:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/magic-link/send`
- `POST /api/v1/auth/password/forgot`
- `POST /api/v1/auth/password/reset`
- `POST /api/v1/auth/email/verify`
- `GET /api/v1/auth/oauth/:provider` (OAuth initiation)

Schema default is `CAPTCHA_PROVIDER=disabled`. In `development` / `test`, verification is skipped when Turnstile is not configured. Optional `CAPTCHA_BYPASS_HEADER` (non-production only) allows local testing. Failures return **401** with `errors:captchaRequired` or `errors:captchaInvalid`.

**Production boot guard.** Because `captchaPreHandler` fail-closes when CAPTCHA is unconfigured, a production deploy with the default `CAPTCHA_PROVIDER=disabled` would turn login, magic-link, password recovery, email verification, and OAuth initiation into **401**s. Boot fails in production unless Turnstile is fully configured (see `src/shared/config/env-schema.ts`):

| Posture                            | Required env                                    | Auth-route behavior                                                   |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| **Production (required)**          | `CAPTCHA_PROVIDER=turnstile` + `CAPTCHA_SECRET` | Verify `X-Captcha-Token`; fail-closed on missing or invalid tokens.   |
| **Development / test**             | Default `CAPTCHA_PROVIDER=disabled`             | Middleware fail-opens; optional `CAPTCHA_BYPASS_HEADER` for local UX. |

Outside production (`development`, `test`), the middleware fail-opens by default when Turnstile is not configured.

## Magic-link environment safety

`MagicLinkService.send` **never** returns the raw 6-digit sign-in code in the JSON body. The code leaves the service only via the `AUTH_EVENT.MAGIC_LINK_REQUESTED` event payload (consumed by the mail handler) and the resulting email — identical behavior across every environment. Verification is `POST /api/v1/auth/magic-link/verify` with `{ email, code }`, gated by a per-user attempt cap (the code is low-entropy).

| Guard                     | When it runs                                                  |
| ------------------------- | ------------------------------------------------------------- |
| Zod `FRONTEND_URL` refine | Boot — when set, `FRONTEND_URL` must be a valid `http(s)` URL |

**Test code path:** tests subscribe to `AUTH_EVENT.MAGIC_LINK_REQUESTED` via the `captureNextMagicLinkCode(email)` helper in `src/tests/helpers/magic-link.helper.ts` to obtain the raw code for assertions.

**Deployed environments (Railway development, production):** any valid public `FRONTEND_URL` is accepted. The previous environment-based inline-token leak and its localhost-only `FRONTEND_URL` restriction have been removed.

## WebAuthn (passkeys)

Passkeys use `@simplewebauthn/server` with challenges stored in Redis (`webauthn:challenge:*`, 5-minute TTL).

| Route                                             | Auth   | Purpose                                                 |
| ------------------------------------------------- | ------ | ------------------------------------------------------- |
| `POST /api/v1/auth/me/webauthn/register/options`     | JWT    | Begin enrolment (returns `options` + `challenge_token`) |
| `POST /api/v1/auth/me/webauthn/register/verify`      | JWT    | Complete enrolment; persists public key                 |
| `POST /api/v1/auth/webauthn/authenticate/options` | Public | Begin sign-in (`email` required)                        |
| `POST /api/v1/auth/webauthn/authenticate/verify`  | Public | Complete sign-in; issues JWT + session cookie           |

Environment:

- `WEBAUTHN_RP_ID` — relying party hostname (defaults to first `ALLOWED_ORIGINS` host or `localhost`)
- `WEBAUTHN_RP_NAME` — display name in the passkey prompt (default `core-be`)
- Request `Origin` header is preferred for verification when present

MFA recovery codes (10 single-use) remain under the MFA sub-domain for TOTP backup.

## Related

- [frontend-auth-guide.md](../api/frontend-auth-guide.md) — frontend SPA integration (Bearer + reactive refresh, headers, org switching)
- [csrf-and-session-cookies.md](../security/csrf-and-session-cookies.md)
- [api-versioning.md](../api/api-versioning.md)
- [data-lifecycle-deletion.md](../data/data-lifecycle-deletion.md) — session retention
- [`src/domains/auth/auth.overview.md`](../../../src/domains/auth/auth.overview.md) — domain overview, the five credential types, anti-enumeration invariant
- [`src/domains/auth/sub-domains/auth-method/auth-method.overview.md`](../../../src/domains/auth/sub-domains/auth-method/auth-method.overview.md) — credential records, token flows
- [`src/domains/auth/sub-domains/auth-mfa/auth-mfa.overview.md`](../../../src/domains/auth/sub-domains/auth-mfa/auth-mfa.overview.md) — TOTP enrolment and challenge
- [`src/domains/auth/sub-domains/auth-webauthn/auth-webauthn.overview.md`](../../../src/domains/auth/sub-domains/auth-webauthn/auth-webauthn.overview.md) — passkey ceremonies
- [`src/POLICIES.md`](../../../src/POLICIES.md) — `JWT_*`, `MAGIC_LINK_*`, `MFA_*`, `LOCKOUT_*`, `STRICT_PUBLIC_RATE_LIMIT` policy constants
