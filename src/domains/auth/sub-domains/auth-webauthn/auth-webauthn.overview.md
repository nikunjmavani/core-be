`src/domains/auth/sub-domains/auth-webauthn/`

# Auth WebAuthn

Parent: [auth](../../auth.overview.md)

## Purpose

WebAuthn / passkey enrolment and authentication ceremonies, backed by [@simplewebauthn/server](https://simplewebauthn.dev). Stores per-user credential records keyed by credential id and exposes the standard four-step flow: registration challenge, registration response, authentication challenge, authentication response — plus owner-scoped management (`GET /auth/me/webauthn/credentials` to list, `DELETE /auth/me/webauthn/credentials/{credential_id}` to revoke).

## Key invariants

- **Challenges are server-generated and short-lived**: stored in Redis with `WEBAUTHN_CHALLENGE_TTL_SECONDS = 300` (5 min). Reuse of a challenge is rejected.
- **Credential ids are unique per user**: enrolling the same authenticator twice replaces the row (or is rejected, depending on UX policy).
- **Counter regression detection**: WebAuthn responses include a usage counter; a counter that does not increase indicates a cloned credential and is rejected.
- **Origin + RPID checked**: the relying-party id (`WEBAUTHN_RP_ID` env) and origin must match the values registered with the authenticator.
- **Authentication options are anti-enumerating**: missing email, unknown user, and user-without-passkeys all return the same `errors:invalidEmailOrPassword` response; the public options route also requires CAPTCHA and per-email rate limiting like password login.
- **Opaque public id for management** (sec-r5-M3): each credential row carries a `wac_`-prefixed `public_id`; the list/revoke API returns and accepts that id, never the bigserial `id` or the raw WebAuthn credential blob.
- **Revoke cannot lock a passkey-only user out** (sec-r5-M3): `DELETE …/{credential_id}` requires recent step-up and refuses (`409 webauthnCannotRevokeLastCredential`) to remove a user's last passkey when they hold no other login-capable auth method (password / OAuth / email verification-code). The check + soft-revoke run under the shared per-user credential-mutation advisory lock so they cannot interleave with a sibling passkey/MFA delete. Revocation is soft (`revoked_at`); the partial unique index keeps the raw credential id re-registrable afterward.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> registration_challenged: GET /auth/me/webauthn/register/options
  registration_challenged --> credential_registered: POST /auth/me/webauthn/register/verify
  registration_challenged --> challenge_expired: TTL passes
  credential_registered --> auth_challenged: GET /auth/webauthn/authenticate-options
  auth_challenged --> session: POST /auth/webauthn/authenticate-verify ok
  auth_challenged --> challenge_expired: TTL passes
  credential_registered --> revoked: DELETE /auth/me/webauthn/credentials/{credential_id}
```

## Failure modes

- **Counter regression** → 401, credential flagged.
- **Origin / RPID mismatch** → 401.
- **Request `Origin` not in `ALLOWED_ORIGINS`** → 403 (`errors:originNotAllowed`), rejected before verification.
- **Challenge expired or reused** → 401.
- **Unknown credential id** → 401 (anti-enumeration: response is identical to wrong-signature case).

## Policy constants

- `WEBAUTHN_CHALLENGE_TTL_SECONDS = 300`
