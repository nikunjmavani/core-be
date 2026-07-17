# Frontend endpoint mapping (FE calls → real core-be routes)

A reconciliation of the paths a browser frontend was calling against the routes core-be actually
exposes. **Almost every reported "404 / missing feature" already exists — at a different path.**
This doc is the client-integration checklist to realign the FE; it does not restate server internals.

> Companions: [frontend-auth-guide.md](frontend-auth-guide.md) (Bearer/refresh/headers),
> [route-consistency-and-org-model.md](route-consistency-and-org-model.md) (the org-type model
> and the 422 backstop), and the generated [route catalog](../../routes.txt) (every route, S/I/O columns).
> All success bodies are wrapped in a `{ "data": … }` envelope.

All paths below are under the `/api/v1` prefix. External ids are always the field `id` (a
`<prefix>_<21 chars>` public id); request/response body keys are `snake_case`.

---

## Quick reference

| Feature | FE was calling | Real route(s) | Status |
| ------- | -------------- | ------------- | ------ |
| Passkeys (list) | `GET /auth/me/passkeys` | `GET /auth/me/webauthn/credentials` | Exists — rename |
| Passkeys (register) | `POST /auth/me/passkeys` | `POST /auth/me/webauthn/register/options` → `POST /auth/me/webauthn/register/verify` | Exists — 2-step ceremony |
| Passkeys (delete) | `DELETE /auth/me/passkeys/:id` | `DELETE /auth/me/webauthn/credentials/:credential_id` | Exists — rename |
| Notifications (list) | `GET /me/notifications` | `GET /notify/notifications` | Exists — re-path |
| Notification read | `… /:id/read` | `PATCH /notify/notifications/:notification_id/read` | Exists — re-path |
| Mark all read | `… /read-all` | `POST /notify/notifications/mark-all-read` | Exists — rename |
| Unread count | `… /unread-count` | `GET /notify/notifications/unread-count` | Exists — re-path |
| Notification prefs | `GET/PATCH /me/notification-preferences` | `GET /users/me/notification-preferences`, **`PUT`** | Exists — re-path + method |
| Webhooks | `GET/POST/DELETE /tenancy/organization/webhooks` | `GET/POST /notify/webhooks`, `DELETE /notify/webhooks/:webhook_id` | Exists — re-path |
| MFA confirm | `POST /auth/me/mfa/confirm` | `POST /auth/me/mfa/enroll/confirm` | Exists — re-path |
| MFA status | expects `{ enabled }` | `GET /auth/me/mfa` → factor array | Derive `enabled = factors.length > 0` |
| MFA enroll body | `400 Invalid values` | body must be `{ "method_type": "MFA_TOTP" }` | Fix request body |
| Sessions | expects `device/browser/location/is_current` | `GET /auth/me/sessions` — **now enriched** | Provides `device`, `browser`, `is_current`, raw `ip_address`; no server `location` (geo-locate the IP client-side) |
| Org logo | `PATCH /tenancy/organization { logo_url }` → 400 | upload flow → `PUT /tenancy/organization/logo { key }` | Exists — different flow |
| Billing gate | `capabilities.canManageBilling` (object removed) | gate on `type === 'TEAM'` + `my_permissions` incl. `subscription:manage` | No capability object; use type + permission |

---

## 🔴 "Missing" endpoints — all exist, at different paths

### Passkeys (WebAuthn)

The feature lives under `/auth/me/webauthn/*`. Registration is a **two-step WebAuthn ceremony**, not a
single POST — the browser must run `navigator.credentials.create()` between the two calls.

- **List:** `GET /auth/me/webauthn/credentials` → `[{ id, device_type, backed_up, transports, created_at, last_used_at }]`
- **Register:**
  1. `POST /auth/me/webauthn/register/options` → `{ options, challenge_token }` (requires recent step-up; see below)
  2. browser calls `navigator.credentials.create(options)`
  3. `POST /auth/me/webauthn/register/verify` with `{ challenge_token, response }` (the `RegistrationResponseJSON`)
- **Delete:** `DELETE /auth/me/webauthn/credentials/:credential_id` (the `wac_…` id from the list)
- **Login (passwordless):** public `POST /auth/webauthn/authenticate/options` → `POST /auth/webauthn/authenticate/verify`

> Credential mutations require a recent **step-up** within the step-up window, else `403`. Open one
> via `POST /auth/step-up` with the account's **password**, or — for a **passwordless account with no
> MFA** — a 6-character **email verification code** (`{ code }`, bootstrap-only, so it can enroll a
> first factor). MFA users step up via an **MFA verification** instead.
>
> **Enroll vs destructive:** an email-code step-up window can *enroll* (MFA/passkey/add auth-method)
> but **cannot** perform *destructive* mutations — revoking sessions or deleting a passkey / MFA
> method / auth-method require a **strong** step-up (password or MFA), returning `403`
> `strongStepUpRequired` otherwise.

### Notifications

All under `/notify/notifications` (the user is identified by the bearer token — there is no `/me` segment):

- `GET /notify/notifications` — list
- `GET /notify/notifications/unread-count` — `{ count }`
- `PATCH /notify/notifications/:notification_id/read` — mark one read
- `POST /notify/notifications/mark-all-read` — mark all read (note: `mark-all-read`, not `read-all`)
- `GET /notify/notifications/:notification_id`, `DELETE /notify/notifications/:notification_id`

Item shape: `{ id, type, title, message, data, action_url, action_label, is_read, read_at, created_at }`.

### Notification preferences (per-user)

- `GET /users/me/notification-preferences` → `[{ notification_type, channel, is_enabled }]`
- **`PUT`** `/users/me/notification-preferences` — full-set replace (the method is `PUT`, not `PATCH`)

> Not to be confused with org-level **notification policies** at
> `/tenancy/organization/notification-policies` — those are org defaults, gated by `notification-policy:*`.

### Webhooks (Integrations)

Webhooks live in the **notify** domain (still org-scoped, enforced by `webhook:*` permissions — not the
tenancy path the FE used):

- `GET /notify/webhooks` (`webhook:read`), `POST /notify/webhooks` (`webhook:manage`, idempotency-key required)
- `GET/PATCH/DELETE /notify/webhooks/:webhook_id`
- `POST /notify/webhooks/:webhook_id/test`, `GET /notify/webhooks/:webhook_id/delivery-attempts`

Create body: `{ url (https only), events: string[] (≥1), secret? (≥16 chars, auto-generated if omitted), is_enabled? }`.

### MFA confirm

The confirm step is nested under `/enroll`: **`POST /auth/me/mfa/enroll/confirm`** (the FE used `/auth/me/mfa/confirm`).

---

## 🟠 Shape clarifications

### MFA — the real enroll/confirm contract

core-be's MFA is **factor-list based** (TOTP), enrolled with a proof-of-possession ceremony:

1. `POST /auth/me/mfa/enroll` — body **must** be `{ "method_type": "MFA_TOTP" }` (this is the `400
   Invalid values` cause — the strict schema rejects any other body). → `{ secret, provisioning_uri }`.
   Nothing is persisted yet.
2. Show the `provisioning_uri` as a QR; the user adds it to their authenticator.
3. `POST /auth/me/mfa/enroll/confirm` — body `{ "code": "123456" }`. → `{ recovery_codes[], mfa_method_id }`.
   **Recovery codes are returned exactly once.** Only now is MFA enabled.

Status / list: `GET /auth/me/mfa` → `[{ id, method_type, last_used_at, created_at }]` (empty when none).
**Derive `enabled = factors.length > 0`** client-side; there is no separate `{ enabled }` field.
Other steps: `POST /auth/me/mfa/verify` (step-up), `DELETE /auth/me/mfa/:mfa_method_id` (remove a factor).

### Sessions — now enriched (backend updated)

`GET /auth/me/sessions` now returns the parsed/derived fields the FE expected, **in addition to** the
raw source fields:

```jsonc
{
  "id": "ses_…",
  "ip_address": "203.0.113.42",
  "user_agent": "Mozilla/5.0 (Macintosh …) Chrome/124.0 …",
  "device": "Mac",            // parsed from user_agent; null if unknown
  "browser": "Chrome",        // parsed from user_agent; null if unknown
  "is_current": true,         // the session this request is authenticated with
  "last_active_at": "…", "expires_at": "…", "created_at": "…"
}
```

- `device` / `browser` are best-effort heuristics from the UA string; `null` when unrecognised.
- `ip_address` is the raw source IP; there is **no** server-derived `location` field — geo-locate the IP client-side if you need an approximate region.
- Use `is_current` to badge the active session and to avoid offering "revoke" on it
  (`DELETE /auth/me/sessions/:session_id` refuses the current session with `409` — use logout instead).

---

## 🟡 Field / model clarifications

### Org logo — supported, via the upload flow (not `logo_url`)

`PATCH /tenancy/organization` accepts only `{ name?, slug?, status? }`, so `logo_url` is correctly
rejected (`400`). The logo is an uploaded object, attached by key (same pattern as `PUT /users/me/avatar`):

1. `POST /uploads` with `{ purpose: "organization-logo", for: "organization", … }` → presigned URL + `upload_id`
2. `PUT` the image bytes to the presigned URL
3. `POST /uploads/:upload_id/confirm`
4. **`PUT /tenancy/organization/logo`** with `{ key }` (the `organization-logos/…` key) — requires `organization:update`
5. `DELETE /tenancy/organization/logo` clears it

### Billing — gate on org `type` + the permission (there is no capability object)

There is **no** `capabilities` object on the API. The org `type` says whether billing exists for the
org kind at all (`TEAM` only — a `PERSONAL` org has no subscription); `my_permissions` says whether
*this* member may act. Gate the billing UI in two layers (mirrors backend enforcement — `422` for
personal, `403` for missing perm):

- **Show billing at all?** `active_organization.type === "TEAM"` (hide entirely for personal orgs).
- **Enable manage actions?** `my_permissions.includes("subscription:manage")` (read-only with `subscription:read`).

Both `active_organization.type` and `my_permissions` are already on `GET /auth/me/context` and the
switch-org responses.
