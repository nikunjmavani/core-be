`src/`

# End-to-end feature flows

These are the multi-domain user journeys that touch more than one bounded context. Each flow lists the **trigger**, the **sequence** across domains, the **side effects** the platform produces, and the **failure modes** the platform tolerates.

When a domain `OVERVIEW.md` says **Cross-domain flows: signup-flow, subscription-change-flow**, it is asserting that the domain participates in the journeys documented here. Drift = bug.

## signup-flow

### Trigger

Anonymous user submits an email at the signup form: `POST /api/v1/auth/magic-link`.

### Sequence

```mermaid
sequenceDiagram
  participant Client
  participant Auth as auth.controller
  participant ML as MagicLinkService
  participant US as UserService
  participant DB as Postgres
  participant Bus as event-bus
  participant Mail as mail.processor
  participant Resend
  Client->>Auth: POST /auth/magic-link {email}
  Auth->>ML: send({email})
  ML->>US: findByEmail(email)
  US-->>ML: user | null
  alt user exists
    ML->>DB: insert verification_tokens (MAGIC_LINK, sha256(token), expires_at = now + 15m)
    ML->>Bus: emit AUTH_EVENT.MAGIC_LINK_REQUESTED {email, magic_link_token, expires_in_minutes}
    Bus->>Mail: enqueueEmail (via event handler)
  else user does not exist
    Note over ML: silent success — no token, no event, no email
  end
  ML-->>Auth: {messageKey: success:magicLinkEmailSent, expires_in_minutes: 15}
  Auth-->>Client: 200
  Mail->>Resend: POST /emails (signed)
  Resend-->>Mail: 200
  Client->>Auth: GET /auth/magic-link/verify?token=...
  Auth->>ML: verify({token})
  ML->>DB: UPDATE verification_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL RETURNING *
  ML->>DB: SELECT user
  ML->>DB: INSERT auth_sessions
  ML-->>Auth: {access_token, session_public_id}
  Auth-->>Client: 200 + Set-Cookie session_id
```

### Side effects

- `verification_tokens` row inserted with 15-min TTL (only when the email maps to a real user — anti-enumeration).
- `AUTH_EVENT.MAGIC_LINK_REQUESTED` event emitted on the in-process event bus.
- `mail_outbox` row inserted by the event handler (transactional outbox).
- Mail worker delivers via Resend (best-effort; retries via DLQ).
- On verify: `auth_sessions` row + JWT issued (RS256, 15-minute access-token TTL).

### Failure modes

- **Throttle exceeded** → silent success returned to the client (no token created, no email sent). Anti-enumeration: response is identical to the user-not-found case.
- **Disposable email domain** → 400 `errors:disposableEmail`. Not silent because the user can fix it.
- **Mail enqueue failure** → does not fail the HTTP request; mail outbox sweeper retries.
- **Token replay** → atomic `UPDATE ... RETURNING` consumes the token on the first verify. A race between two concurrent `/verify` requests results in exactly one session.
- **Token expired** → 401 `errors:invalidOrExpiredMagicLink`.

## login-flow

### Trigger

Returning user submits credentials: `POST /api/v1/auth/login`.

### Sequence

```mermaid
sequenceDiagram
  participant Client
  participant Auth as auth.controller
  participant Login as LoginService
  participant US as UserService
  participant AM as AuthMethodService
  participant MFA as MfaService
  participant DB as Postgres
  Client->>Auth: POST /auth/login {email, password}
  Auth->>Login: login(...)
  Login->>US: findByEmail
  Login->>AM: verify password (argon2id)
  alt MFA enabled
    Login->>MFA: createChallenge → mfa_session_token (Redis, 5m)
    Login-->>Auth: {requires_mfa: true, mfa_session_token}
    Auth-->>Client: 200
    Client->>Auth: POST /auth/mfa/login {mfa_session_token, totp_code|recovery_code}
    Auth->>MFA: verifyLoginMfa (validate session token, then TOTP/recovery)
    MFA->>Login: issue access token + session
  end
  Login->>DB: INSERT auth_sessions
  Login-->>Auth: {access_token, session_public_id}
  Auth-->>Client: 200 + Set-Cookie session_id
```

### Side effects

- Failed-attempt counter persisted on the user row (`users.failed_login_count`, per account). After `MAX_FAILED_LOGIN_ATTEMPTS` (10), the account locks for `ACCOUNT_LOCKOUT_MINUTES` (30 minutes). The lock is evaluated after password verification, so a correct password always bypasses it and clears the counter — the lock only rejects further wrong attempts (no victim-account DoS). Online brute force is bounded by the per-IP + per-email rate limits and CAPTCHA.
- On success: `auth_sessions` row + JWT issued; failed-attempt counter cleared; audit log row written via `audit-emission`.
- On MFA path: `mfa_session_token` written to Redis with `MFA_SESSION_TTL_SECONDS` (5 min).

### Failure modes

- **Wrong password** → 401, generic message; failed-attempt counter incremented.
- **Account locked + wrong password** → `errors:accountLocked` until the lockout window passes; a correct password during the window authenticates and lifts the lock.
- **MFA challenge expired** → 401 `errors:mfaSessionExpired`; client must re-login.
- **Disabled or unverified user** → 401 with the appropriate message key; behavior identical to wrong-password from the client's perspective for non-existent emails (anti-enumeration).

## organization-invitation-flow

### Trigger

Organization admin invites a teammate: `POST /api/v1/tenancy/organization/invitations` (active org from the `org` token claim). Only **team** organizations support this — a personal org rejects it with 422 (`errors:personalOrganizationNoMembers`), advertised by `capabilities.can_invite_members: false` on the org response. Revoke is `DELETE /api/v1/tenancy/organization/invitations/:invitation_id`.

### Sequence

```mermaid
sequenceDiagram
  participant Admin as Admin Client
  participant Tenancy as tenancy.controller
  participant Inv as MemberInvitationService
  participant DB as Postgres (RLS scoped to org)
  participant Bus as event-bus
  participant Mail as mail.processor
  participant Invitee as Invitee Client
  participant Auth as auth.controller
  Admin->>Tenancy: POST /organization/invitations {email, member_role}
  Tenancy->>Inv: create(orgId, body, invitedByUserId)
  Inv->>DB: BEGIN; SET LOCAL app.current_organization_id
  Inv->>DB: insert member_invitations (token_hash, expires_at, status=pending)
  Inv->>DB: COMMIT
  Inv->>Bus: emit MEMBER_INVITATION_EVENT.CREATED {email, raw_token, organization_name, ...}
  Bus->>Mail: enqueueEmail (via event handler)
  Mail-->>Invitee: invitation email (raw_token in URL)

  Invitee->>Auth: POST /auth/magic-link {email} (signup-flow if new user)
  Note over Invitee,Auth: invitee establishes a session

  Invitee->>Tenancy: POST /tenancy/invitations/:invitation_id/accept {token}
  Tenancy->>Inv: accept(invitationId, token, currentUserId)
  Inv->>DB: BEGIN; SET LOCAL app.current_organization_id
  Inv->>DB: UPDATE member_invitations SET status=accepted, accepted_at=NOW() WHERE token_hash=$1
  Inv->>DB: INSERT memberships (user_id, organization_id, member_role_id)
  Inv->>DB: COMMIT
  Inv-->>Tenancy: {membership}
  Tenancy-->>Invitee: 200
```

### Side effects

- `member_invitations` row created with hashed token; raw token leaves the platform only via the email payload (parallel to `magic-link`).
- `MEMBER_INVITATION_EVENT.CREATED` event → mail outbox row → invitation email delivered.
- On accept: `memberships` row created; permission cache invalidated for the new member.
- Audit log row recorded for both create and accept (`audit-emission`).

### Failure modes

- **Disposable email** → 400 `errors:disposableEmail`.
- **Invitee already a member** → 409 `errors:invitationAlreadyMember`.
- **Token expired** → 401 `errors:invitationTokenExpired`.
- **Token reuse** → atomic `UPDATE ... RETURNING` consumes the row on first accept; second attempt sees `status=accepted` and returns 409.
- **Invitation cancelled before accept** → 410 `errors:invitationCancelled`.

## subscription-change-flow

### Trigger

Two paths:

- **Inbound (authoritative)**: Stripe sends `customer.subscription.updated` → `POST /api/v1/billing/webhook`.
- **User-initiated**: organization admin calls `POST /api/v1/billing/organizations/:id/subscriptions/:subscription_id/change-plan`. The service calls Stripe; the inbound webhook lands shortly after and reconciles state.

State changes always flow Stripe webhook → service → DB → emit event. We never write subscription state to DB without a Stripe-confirmed event behind it.

### Sequence

```mermaid
sequenceDiagram
  participant Stripe
  participant Ingest as stripe-webhook.routes
  participant SWS as StripeWebhookService
  participant Sub as SubscriptionService
  participant DB as Postgres (RLS scoped to org)
  participant Bus as event-bus
  participant Notify as notify worker
  participant Mail as mail.processor

  Stripe->>Ingest: POST /api/v1/billing/webhook (Stripe-Signature)
  Ingest->>SWS: verifySignatureAndPersist (raw body)
  SWS->>DB: insert stripe_webhook_events (status=processing) ON CONFLICT (event_id) DO NOTHING
  alt new event
    SWS->>Sub: syncFromStripeProviderSubscription(provider_id, data, event.created_at)
    Sub->>DB: BEGIN; SET LOCAL app.current_organization_id
    Sub->>DB: UPDATE subscriptions SET ... WHERE provider_subscription_id=$1
    Sub->>DB: COMMIT
    Sub->>Bus: emit BILLING_EVENT.SUBSCRIPTION_UPDATED
    SWS->>DB: UPDATE stripe_webhook_events SET status=processed
  else duplicate event_id
    Note over SWS: insert returns no rows; idempotent no-op
  end
  Ingest-->>Stripe: 200

  Bus->>Notify: notification fan-out (in-app + email)
  Notify->>Mail: enqueueEmail
```

### Side effects

- `stripe_webhook_events` row keyed by Stripe `event.id` (idempotent inbound).
- `subscriptions` table updated with the latest Stripe state.
- `BILLING_EVENT.SUBSCRIPTION_UPDATED` (or `_CREATED`, `_CANCELED`) emitted.
- Notification fan-out: in-app notification row + email through the mail outbox.
- Audit log row for the state transition.

### Failure modes

- **Invalid Stripe signature** → 400; Stripe retries.
- **Duplicate `event.id`** → silently no-op (unique constraint); Stripe retries are safe.
- **Stripe API timeout (user-initiated path)** → response surfaces 502; Stripe will eventually send the webhook and the row reconciles. We do not optimistically write state.
- **Worker crash mid-processing** → row stuck in `processing`; reclaim worker (`stripe-webhook-event-reclaim.processor`) restarts it after `STRIPE_WEBHOOK_STUCK_PROCESSING_LEASE_MINUTES` (15 min).
- **Stale event** (timestamp older than current row) → service rejects the update so out-of-order webhooks don't roll state backwards.

## dunning-flow

### Trigger

Stripe sends a billing-failure webhook (`invoice.payment_failed`, `customer.subscription.updated` with `past_due`) → `POST /api/v1/billing/webhook`.

### Sequence

```mermaid
sequenceDiagram
  participant Stripe
  participant Ingest as stripe-webhook.routes
  participant Sub as SubscriptionService
  participant DB as Postgres
  participant Bus as event-bus
  participant Notify as notify worker
  participant Mail as mail.processor
  participant Org as organization owner

  Stripe->>Ingest: invoice.payment_failed
  Ingest->>Sub: syncFromStripeProviderSubscription(state=past_due)
  Sub->>DB: UPDATE subscriptions SET status=past_due
  Sub->>Bus: emit BILLING_EVENT.SUBSCRIPTION_PAST_DUE
  Bus->>Notify: enqueue notification (in-app)
  Bus->>Mail: enqueueEmail (payment-failed template)
  Notify-->>Org: in-app banner
  Mail-->>Org: payment-failed email (with hosted billing link)

  loop while past_due
    Stripe->>Ingest: subsequent dunning attempts (Stripe smart retries)
  end

  alt Stripe gives up
    Stripe->>Ingest: customer.subscription.deleted
    Ingest->>Sub: markCanceledByStripeProviderSubscriptionId
    Sub->>Bus: emit BILLING_EVENT.SUBSCRIPTION_CANCELED
    Bus->>Notify: enqueue cancellation notification + email
  else customer pays
    Stripe->>Ingest: invoice.paid + subscription.updated(active)
    Ingest->>Sub: syncFromStripeProviderSubscription(state=active)
    Sub->>Bus: emit BILLING_EVENT.SUBSCRIPTION_ACTIVE
  end
```

### Side effects

- `subscriptions.status` transitions: `active` → `past_due` (and back, or onward to `canceled`).
- `BILLING_EVENT.SUBSCRIPTION_PAST_DUE` / `..._CANCELED` / `..._ACTIVE` events emitted.
- Notification + email per state transition.
- Audit log row for every state transition.

### Failure modes

- **All standard subscription-change-flow failure modes apply** (signature, duplicate event id, stale events, worker crash).
- **Notification delivery failure** → does not fail webhook processing; webhook delivery worker retries with backoff and lands in DLQ after exhausted retries.
- **Customer ignores the dunning emails** → Stripe-driven cancellation eventually fires; the platform does not unilaterally cancel.
