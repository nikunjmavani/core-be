# Authorization matrix — route model review

> Review artifact. Generated from `tooling/openapi/route-catalog/route-authorization-model.json` on 2026-06-15.

Every protected by-id route (plus the two owner-tier routes) and the authorization **model** assigned to it. Please review each row; to change one, tell me e.g. *"`PATCH /…/memberships/:id` should be `org`, not `tier:owner`"*. Once you are happy, I build the Phase 2 attack tests against exactly these models.

**Total routes modelled: 48.**

---

## Models (legend)

| Model | Meaning | Attacker the test uses | Expected |
| --- | --- | --- | --- |
| `user` | Cross-user (intra-tenant) BOLA | another authenticated user | 404 |
| `org` | Cross-org BOLA | a member of a different organization | 404 / 403 |
| `email` | Email-targeted ownership | a user whose email ≠ the invitation | 403 |
| `tier:owner` | Owner-tier protection | a non-owner / lower-tier member acting on the owner | 403 |
| `grant` | Grant-grantability | a manager granting a permission they do not hold | 403 |
| `global-role` | Global-role (admin-only) | a regular (non-admin) authenticated user | 401 / 403 |

> `verifyNoMutation` = for a denied **write**, the test also reads the row back and asserts nothing changed.

---

## `user` — Cross-user (intra-tenant) BOLA (10) → expect 404

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| DELETE | `/api/v1/auth/me/auth-methods/:auth_method_id` | yes |
| DELETE | `/api/v1/auth/me/sessions/:session_id` | yes |
| DELETE | `/api/v1/auth/mfa/:mfa_method_id` | yes |
| DELETE | `/api/v1/notify/notifications/:notification_id` | yes |
| DELETE | `/api/v1/uploads/:upload_id` | yes |
| GET | `/api/v1/notify/notifications/:notification_id` | — |
| GET | `/api/v1/uploads/:upload_id` | — |
| GET | `/api/v1/users/me/data-export/:export_id` | — |
| PATCH | `/api/v1/notify/notifications/:notification_id/read` | yes |
| POST | `/api/v1/uploads/:upload_id/confirm` | yes |

## `org` — Cross-org BOLA (26) → expect 404 / 403

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| DELETE | `/api/v1/notify/webhooks/:webhook_id` | yes |
| DELETE | `/api/v1/tenancy/organization/api-keys/:api_key_id` | yes |
| DELETE | `/api/v1/tenancy/organization/invitations/:invitation_id` | yes |
| DELETE | `/api/v1/tenancy/organization/notification-policies/:policy_id` | yes |
| DELETE | `/api/v1/tenancy/organization/roles/:role_id` | yes |
| GET | `/api/v1/billing/subscriptions/:subscription_id` | — |
| GET | `/api/v1/notify/webhooks/:webhook_id` | — |
| GET | `/api/v1/notify/webhooks/:webhook_id/delivery-attempts` | — |
| GET | `/api/v1/tenancy/organization/api-keys/:api_key_id` | — |
| GET | `/api/v1/tenancy/organization/memberships/:membership_id` | — |
| GET | `/api/v1/tenancy/organization/memberships/:membership_id/permissions` | — |
| GET | `/api/v1/tenancy/organization/notification-policies/:policy_id` | — |
| GET | `/api/v1/tenancy/organization/roles/:role_id` | — |
| GET | `/api/v1/tenancy/organization/roles/:role_id/permissions` | — |
| GET | `/api/v1/tenancy/organizations/by-slug/:slug` | — |
| PATCH | `/api/v1/billing/subscriptions/:subscription_id` | yes |
| PATCH | `/api/v1/notify/webhooks/:webhook_id` | yes |
| PATCH | `/api/v1/tenancy/organization/api-keys/:api_key_id` | yes |
| PATCH | `/api/v1/tenancy/organization/notification-policies/:policy_id` | yes |
| PATCH | `/api/v1/tenancy/organization/roles/:role_id` | yes |
| POST | `/api/v1/billing/subscriptions/:subscription_id/cancel` | yes |
| POST | `/api/v1/billing/subscriptions/:subscription_id/change-plan` | yes |
| POST | `/api/v1/billing/subscriptions/:subscription_id/resume` | yes |
| POST | `/api/v1/notify/webhooks/:webhook_id/test` | — |
| POST | `/api/v1/tenancy/organization/api-keys/:api_key_id/rotate` | yes |
| POST | `/api/v1/tenancy/organization/invitations/:invitation_id/resend` | — |

## `email` — Email-targeted ownership (2) → expect 403

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| POST | `/api/v1/tenancy/invitations/:invitation_id/accept` | yes |
| POST | `/api/v1/tenancy/invitations/:invitation_id/decline` | yes |

## `tier:owner` — Owner-tier protection (4) → expect 403

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| DELETE | `/api/v1/tenancy/organization/memberships/:membership_id` | yes |
| PATCH | `/api/v1/tenancy/organization/memberships/:membership_id` | yes |
| POST | `/api/v1/tenancy/organization/leave` | — |
| POST | `/api/v1/tenancy/organization/transfer-ownership` | yes |

## `grant` — Grant-grantability (1) → expect 403

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| PUT | `/api/v1/tenancy/organization/roles/:role_id/permissions` | yes |

## `global-role` — Global-role (admin-only) (5) → expect 401 / 403

| Method | Path | verifyNoMutation |
| --- | --- | --- |
| DELETE | `/api/v1/users/:user_id` | yes |
| GET | `/api/v1/users/:user_id` | — |
| PATCH | `/api/v1/users/:user_id` | yes |
| POST | `/api/v1/users/:user_id/suspend` | yes |
| POST | `/api/v1/users/:user_id/unsuspend` | yes |

---

## Build plan (after you approve the models above)

1. **Factories** — add victim-object creators returning `public_id` for the resources not yet wired: `notification`, `auth-session`, `mfa_method`, `auth_method`, `data_export`, `api_key`, `notification_policy`, `member_invitation`. (`upload`, `subscription`, `webhook`, `role`, `membership` already reuse existing fixtures.)
2. **Engine** — `authz-attack.helper.ts`: per-model attacker builder + path materialization + request/body/idempotency headers + assertion + `verifyNoMutation` read-back + positive baseline.
3. **Tests** (`src/tests/security/authz/`) — iterate the model file: `object-ownership` (`user`/`email`/`org`), `tier-and-grant` (`tier:owner`/`grant`), `admin-only` (`global-role`). No silent skips.
4. **Phase 3 hardening** — extend the coverage gate to every mutation (models `self`/`public`/`function`), add the static `findByPublicId` ban.
5. **Verify** — typecheck locally; the e2e attacks run in CI (`reusable-vitest-postgres-redis`, Postgres + Redis). This environment has no Docker, so green is confirmed in CI.

## Built (Phase 2 complete — all 48 routes, verified green)

Every modelled route now has a dedicated attacker test. The suite is **80 tests
across 7 files** under `src/tests/security/authz/` (e2e, Postgres + Redis):

| Suite | Models | Coverage |
| --- | --- | --- |
| `object-ownership.security.test.ts` | `user` (10) + `org`/subscription read | cross-user 404 + baselines + `verifyNoMutation`; step-up-gated session/MFA/auth-method |
| `cross-org-resource.security.test.ts` | `org` reads (10) | cross-org GET → 404 + same-org 200 baseline; by-slug scoped separately |
| `cross-org-mutation.security.test.ts` | `org` writes (16) | cross-org PATCH/DELETE/POST/rotate → 404 (valid bodies + Idempotency-Key); subscriptions via two-org fixture |
| `tier-and-grant.security.test.ts` | `tier:owner` (4) + `grant` (1) | non-owner/owner-membership protection; grant-grantability + cross-org PUT |
| `admin-only.security.test.ts` | `global-role` (5) | every `/users/:user_id` admin route: regular user → 401/403 + admin baseline |
| `invitation-email.security.test.ts` | `email` (2) | email-mismatch accept/decline → 403 + invitee baseline |
| `auth-token-flow.security.test.ts` | (authn lifecycle) | bearer-contract + revoked-session 401 (complements `jwt-attacks`) |

**Gates (both DB-free, run in the `global` project):**

- `authz-model-coverage.global.test.ts` — every object-by-id route *declares* a model (no missing/orphan/unknown).
- `authz-runtime-coverage.global.test.ts` — every modelled route is *exercised* by a mapped runtime test; a new by-id route fails CI until both a model entry and an attack test exist.
