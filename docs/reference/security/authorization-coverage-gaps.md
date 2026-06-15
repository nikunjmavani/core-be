# Authorization coverage & gap map (all routes)

> Point-in-time analysis derived from `docs/routes.txt` + `tooling/openapi/route-catalog/route-authorization-model.json`. Generated 2026-06-15.

Answers "is every route — organization-level included — covered, and what is **not** in the codebase/tests yet?" Companion to [`authorization-testing-plan.md`](./authorization-testing-plan.md).

**Total routes: 131.** Every route is classified into one authorization bucket below; the "Gap" column states what is missing.

---

## Coverage at a glance

| Bucket | Count | Guard (in code) | Tested by | Gap |
| --- | --- | --- | --- | --- |
| `auth-by-id` | 13 | Ownership filter / user RLS / email-match | repo unit (upload only) | ❌ PRIMARY GAP — no e2e cross-user BOLA; closed by Phase 2 matrix |
| `org-by-id` | 28 | Org permission + org RLS | permission-route-matrix (BFLA); bola-cross-tenant (role/membership/webhook only) | ⚠ cross-org BOLA e2e missing for subscriptions/api-keys/policies/invitations |
| `org-collection` | 22 | Org permission middleware | permission-route-matrix (every PERM route) | ✅ BFLA; grant-grantability on creates only partially asserted |
| `global-role` | 9 | JWT global role claim | privilege-escalation (sample) + permission tests | ⚠ not every admin route individually asserted for regular-user denial |
| `auth-self-mutation` | 24 | Auth; acts on caller (/me) | auth-enforcement (401), mass-assignment (subset) | ⚠ caller-scoped; no per-route assertion |
| `auth-self-list` | 12 | Auth; results scoped to caller | auth-enforcement (401) | ✅ low risk (caller-scoped list) |
| `public` | 20 | None (some need X-Captcha-Token / Stripe-Signature) | public-routes, captcha, oauth-callback, stripe-webhook | ⚠ business-flow abuse (API6) not systematically tested |
| `bearer-token` | 3 | Service/metrics token | api-key-auth, ops route tests | ✅ low |

---

## What is NOT in the codebase / tests yet

> **Reconciliation with integration tests:** the per-domain `*.integration` suites already cover more than the dedicated `security/` suite. For example `membership.integration` asserts cross-org `404` (invitation revoke/resend, membership-permission lookup), owner-tier `403` (`transfer-ownership`, owner-cannot-leave), and email-match `403` (decline someone else's invitation). The gaps below are what remains **after** counting those.

1. **Cross-user (intra-tenant) BOLA — `auth-by-id` (13 routes).** Ownership is enforced in repositories today, but there is **no end-to-end test** that User B is denied User A's object. Only `upload` has a repo-level unit test. *This is the primary gap.*
2. **Cross-org BOLA e2e — remaining `org-by-id` resources.** BFLA is fully covered by the permission matrix; cross-org object access is e2e-tested for `role`, `membership`, `webhook` (security suite) plus `invitation` and membership-permission lookups (`membership.integration`). The residual with **no cross-org BOLA e2e** is `subscription`, `api-key`, and `notification-policy`.
3. **Grant-grantability on create paths.** `assertCallerCanGrantPermissionCodes` is unit-tested for role-permission PUT, but create paths (`POST roles`, `POST invitations`, api-key scopes) are not all asserted at the route level.
4. **Global-role denial — `global-role` (9 routes).** A regular user is sampled against one admin route; the per-route "regular user → 403" assertion is not exhaustive across all admin/super_admin routes.
5. **Caller-scope on `auth-self-mutation` (24 routes).** Guarded by auth + `/me` scoping, but there is no per-route assertion that the body cannot redirect the action to another user (mass-assignment covers a subset only).
6. **Business-flow abuse (OWASP API6) on `public`/auth flows.** Rate-limit + captcha exist; multi-step flow abuse (e.g. invitation/checkout sequencing) is not systematically tested.
7. **Spec validity (found while wiring Hadrian).** The generated OpenAPI sets `example`+`examples` together and uses PCRE-lookahead `pattern`s — invalid for strict parsers. Tracked in `tooling/hadrian/README.md`.

---

## Full route inventory

> The Status column reflects **dedicated** authorization coverage; per-domain `*.integration` tests add further cross-org/tier/email assertions (see Reconciliation above).

### AUDIT (1)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/audit/logs` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |

### AUTH (32)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/email/resend-verification` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/email/verify` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/login` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/logout` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/magic-link/send` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/magic-link/verify` | PUBLIC | `public` | — (n/a authz) |
| GET | `/api/v1/auth/me/auth-methods` | AUTH | `auth-self-list` | ✅ caller-scoped |
| POST | `/api/v1/auth/me/auth-methods` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| DELETE | `/api/v1/auth/me/auth-methods/:auth_method_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| GET | `/api/v1/auth/me/sessions` | AUTH | `auth-self-list` | ✅ caller-scoped |
| DELETE | `/api/v1/auth/me/sessions` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| DELETE | `/api/v1/auth/me/sessions/:session_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| GET | `/api/v1/auth/mfa` | AUTH | `auth-self-list` | ✅ caller-scoped |
| DELETE | `/api/v1/auth/mfa/:mfa_method_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| POST | `/api/v1/auth/mfa/enroll` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/mfa/enroll/confirm` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/mfa/login` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/mfa/verify` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/auth/oauth/:provider` | PUBLIC | `public` | — (n/a authz) |
| GET | `/api/v1/auth/oauth/:provider/callback` | PUBLIC | `public` | — (n/a authz) |
| GET | `/api/v1/auth/oauth/providers` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/password/change` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/password/forgot` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/password/reset` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/refresh` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/step-up` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/switch-to-organization` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/switch-to-personal` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/webauthn/authenticate/options` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/webauthn/authenticate/verify` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/auth/webauthn/register/options` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/auth/webauthn/register/verify` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |

### BILLING (11)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/billing/plans` | PUBLIC | `public` | — (n/a authz) |
| GET | `/api/v1/billing/plans/:plan_id` | PUBLIC | `public` | — (n/a authz) |
| POST | `/api/v1/billing/stripe/webhook` | PUBLIC | `public` | — (n/a authz) |
| GET | `/api/v1/billing/subscriptions` | PERM: subscription:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/billing/subscriptions` | PERM: subscription:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/billing/subscriptions/:subscription_id` | PERM: subscription:read | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| PATCH | `/api/v1/billing/subscriptions/:subscription_id` | PERM: subscription:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/billing/subscriptions/:subscription_id/cancel` | PERM: subscription:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/billing/subscriptions/:subscription_id/change-plan` | PERM: subscription:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/billing/subscriptions/:subscription_id/resume` | PERM: subscription:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/billing/webhook` | PUBLIC | `public` | — (n/a authz) |

### MCP (2)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/mcp` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| POST | `/api/v1/mcp` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |

### NOTIFY (14)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/notify/notifications` | AUTH | `auth-self-list` | ✅ caller-scoped |
| GET | `/api/v1/notify/notifications/:notification_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| DELETE | `/api/v1/notify/notifications/:notification_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| PATCH | `/api/v1/notify/notifications/:notification_id/read` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| POST | `/api/v1/notify/notifications/mark-all-read` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/notify/notifications/unread-count` | AUTH | `auth-self-list` | ✅ caller-scoped |
| GET | `/api/v1/notify/webhook-events` | PERM: webhook:read | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/notify/webhooks` | PERM: webhook:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/notify/webhooks` | PERM: webhook:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/notify/webhooks/:webhook_id` | PERM: webhook:read | `org-by-id` | ✅ BFLA + cross-org |
| PATCH | `/api/v1/notify/webhooks/:webhook_id` | PERM: webhook:manage | `org-by-id` | ✅ BFLA + cross-org |
| DELETE | `/api/v1/notify/webhooks/:webhook_id` | PERM: webhook:manage | `org-by-id` | ✅ BFLA + cross-org |
| GET | `/api/v1/notify/webhooks/:webhook_id/delivery-attempts` | PERM: webhook:read | `org-by-id` | ✅ BFLA + cross-org |
| POST | `/api/v1/notify/webhooks/:webhook_id/test` | PERM: webhook:manage | `org-by-id` | ✅ BFLA + cross-org |

### TENANCY (45)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/tenancy/invitations/:invitation_id/accept` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| POST | `/api/v1/tenancy/invitations/:invitation_id/decline` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| GET | `/api/v1/tenancy/invitations/pending` | AUTH | `auth-self-list` | ✅ caller-scoped |
| GET | `/api/v1/tenancy/organization` | AUTH | `auth-self-list` | ✅ caller-scoped |
| PATCH | `/api/v1/tenancy/organization` | PERM: organization:update | `org-collection` | ✅ BFLA (matrix) |
| DELETE | `/api/v1/tenancy/organization` | PERM: organization:delete | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/api-keys` | PERM: api-key:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/api-keys` | PERM: api-key:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/api-keys/:api_key_id` | PERM: api-key:read | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| PATCH | `/api/v1/tenancy/organization/api-keys/:api_key_id` | PERM: api-key:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| DELETE | `/api/v1/tenancy/organization/api-keys/:api_key_id` | PERM: api-key:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/tenancy/organization/api-keys/:api_key_id/rotate` | PERM: api-key:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| GET | `/api/v1/tenancy/organization/audit-logs` | PERM: audit-log:read | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/invitations` | PERM: invitation:manage | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/invitations` | PERM: invitation:manage | `org-collection` | ✅ BFLA (matrix) |
| DELETE | `/api/v1/tenancy/organization/invitations/:invitation_id` | PERM: invitation:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/tenancy/organization/invitations/:invitation_id/resend` | PERM: invitation:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| POST | `/api/v1/tenancy/organization/leave` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| PUT | `/api/v1/tenancy/organization/logo` | PERM: organization:update | `org-collection` | ✅ BFLA (matrix) |
| DELETE | `/api/v1/tenancy/organization/logo` | PERM: organization:update | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/memberships` | PERM: membership:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/memberships` | PERM: membership:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/memberships/:membership_id` | PERM: membership:read | `org-by-id` | ✅ BFLA + cross-org |
| PATCH | `/api/v1/tenancy/organization/memberships/:membership_id` | PERM: membership:manage | `org-by-id` | ✅ BFLA + cross-org |
| DELETE | `/api/v1/tenancy/organization/memberships/:membership_id` | PERM: membership:manage | `org-by-id` | ✅ BFLA + cross-org |
| GET | `/api/v1/tenancy/organization/memberships/:membership_id/permissions` | PERM: membership:read | `org-by-id` | ✅ BFLA + cross-org |
| GET | `/api/v1/tenancy/organization/notification-policies` | PERM: notification-policy:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/notification-policies` | PERM: notification-policy:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/notification-policies/:policy_id` | PERM: notification-policy:read | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| PATCH | `/api/v1/tenancy/organization/notification-policies/:policy_id` | PERM: notification-policy:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| DELETE | `/api/v1/tenancy/organization/notification-policies/:policy_id` | PERM: notification-policy:manage | `org-by-id` | ⚠ BFLA ✓; cross-org pending (P2) |
| GET | `/api/v1/tenancy/organization/roles` | PERM: role:read | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/roles` | PERM: role:manage | `org-collection` | ✅ BFLA (matrix) |
| GET | `/api/v1/tenancy/organization/roles/:role_id` | PERM: role:read | `org-by-id` | ✅ BFLA + cross-org |
| PATCH | `/api/v1/tenancy/organization/roles/:role_id` | PERM: role:manage | `org-by-id` | ✅ BFLA + cross-org |
| DELETE | `/api/v1/tenancy/organization/roles/:role_id` | PERM: role:manage | `org-by-id` | ✅ BFLA + cross-org |
| GET | `/api/v1/tenancy/organization/roles/:role_id/permissions` | PERM: role:read | `org-by-id` | ✅ BFLA + cross-org |
| PUT | `/api/v1/tenancy/organization/roles/:role_id/permissions` | PERM: role:manage | `org-by-id` | ✅ BFLA + cross-org |
| GET | `/api/v1/tenancy/organization/settings` | PERM: organization:read | `org-collection` | ✅ BFLA (matrix) |
| PATCH | `/api/v1/tenancy/organization/settings` | PERM: organization:update | `org-collection` | ✅ BFLA (matrix) |
| POST | `/api/v1/tenancy/organization/transfer-ownership` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/tenancy/organizations` | AUTH | `auth-self-list` | ✅ caller-scoped |
| POST | `/api/v1/tenancy/organizations` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/tenancy/organizations/by-slug/:slug` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| GET | `/api/v1/tenancy/permissions` | AUTH | `auth-self-list` | ✅ caller-scoped |

### UPLOAD (4)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/uploads` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/uploads/:upload_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| DELETE | `/api/v1/uploads/:upload_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| POST | `/api/v1/uploads/:upload_id/confirm` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |

### USER (17)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/users` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| GET | `/api/v1/users/:user_id` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| PATCH | `/api/v1/users/:user_id` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| DELETE | `/api/v1/users/:user_id` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| POST | `/api/v1/users/:user_id/suspend` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| POST | `/api/v1/users/:user_id/unsuspend` | ROLE: super_admin, admin | `global-role` | ⚠ partial (admin-deny) |
| GET | `/api/v1/users/me` | AUTH | `auth-self-list` | ✅ caller-scoped |
| PATCH | `/api/v1/users/me` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| DELETE | `/api/v1/users/me` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| PUT | `/api/v1/users/me/avatar` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| DELETE | `/api/v1/users/me/avatar` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| POST | `/api/v1/users/me/data-export` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/users/me/data-export/:export_id` | AUTH | `auth-by-id` | ❌ no e2e cross-user (Phase 2) |
| GET | `/api/v1/users/me/notification-preferences` | AUTH | `auth-self-list` | ✅ caller-scoped |
| PUT | `/api/v1/users/me/notification-preferences` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |
| GET | `/api/v1/users/me/settings` | AUTH | `auth-self-list` | ✅ caller-scoped |
| PATCH | `/api/v1/users/me/settings` | AUTH | `auth-self-mutation` | ⚠ self; not asserted |

### OPS (2)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/internal/ops/circuit-breakers` | TOKEN: metrics | `bearer-token` | ✅ token-auth |
| POST | `/internal/ops/circuit-breakers/:circuit_name/reset` | TOKEN: metrics | `bearer-token` | ✅ token-auth |

### HEALTH (2)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/livez` | PUBLIC | `public` | — (n/a authz) |
| GET | `/readyz` | PUBLIC | `public` | — (n/a authz) |

### METRICS (1)

| Method | Path | Access | Bucket | Status |
| --- | --- | --- | --- | --- |
| GET | `/metrics` | TOKEN: metrics | `bearer-token` | ✅ token-auth |

---

## How the gaps close

- **Phase 1 (done):** `route-authorization-model.json` (48 entries) declares the model for all 46 by-id protected routes + 2 invariant routes; `authz-model-coverage.global.test.ts` fails CI if a by-id route is added without a model entry.
- **Phase 2 (next):** the catalog-driven matrix consumes the model and asserts attacker outcomes e2e (cross-user, cross-org, tier, grant) with state-change verification — closing gaps 1–3.
- **Phase 3:** extend the gate to require a model for every mutation (not just by-id) — closing gaps 4–5 by construction.
