# Personal & Team Organizations

How one user account works across a **personal** organization and any number of **team**
organizations, and how the active organization is carried as a signed token claim.

> Vocabulary: everything is an **organization** (`organizations.type IN ('PERSONAL','TEAM')`).
> "Personal" is a UI label for the personal organization. There is no "workspace" concept.

## Model

- A user owns **exactly one** `PERSONAL` organization (auto-provisioned at signup, enforced by
  the `idx_org_one_personal_per_owner` partial unique index) and belongs to **N** `TEAM`
  organizations via `memberships`.
- The `PERSONAL` organization has a **null slug** (never user-facing — its app URL is `/`) and is
  **immutable**: it cannot be deleted or have its ownership transferred (`409
  personalOrganizationImmutable`); it is removed only when the account is deleted (cascade).
- Internal joins/FKs use the integer PK `organizations.id`; `public_id` (`org_…`) and `slug` are
  external-only identifiers.

## Capability flags (deployment modes)

```text
PERSONAL_ORGANIZATION_ENABLED   (default true)
TEAM_ORGANIZATION_ENABLED       (default true)   — at least one must be true
```

| Mode | PERSONAL | TEAM | Signup | Login default |
|------|----------|------|--------|---------------|
| Hybrid | on | on | personal org auto-provisioned | personal org |
| B2C | on | off | personal org auto-provisioned | personal org |
| B2B | off | on | nothing provisioned | most-recent team, else **none** → frontend redirects to "create your own" |

`GET /users/me` returns `capabilities { personal_organizations, team_organizations }` and
`personal_organization_id` so the frontend can render the switcher and hide the disabled kind.

## Token model (active organization = signed claim)

The active organization is a signed JWT claim (`org`), not a header or path parameter. It is
**scope, not authority** — membership + RLS are re-checked per request.

| Endpoint | Effect |
|----------|--------|
| `POST /auth/login` (and magic-link / OAuth / WebAuthn) | mints the token with the default-organization `org` claim |
| `POST /auth/refresh` | re-mints with the resolved `org` claim |
| `POST /auth/switch-to-personal` | no body; re-mints + re-binds the session to the caller's personal org |
| `POST /auth/switch-to-organization { organization_id }` | membership-validated (403 if not a member, 400 missing id); re-mints + re-binds |

Switching re-mints the access token and re-binds the session's `token_hash` to it (no refresh
rotation); the previously held token immediately fails `verifyActiveAccessToken` (hash drift).

## Account deletion

`countActiveOwnedByUser` counts only `type='TEAM'` organizations — owning a team org blocks
account deletion (transfer or delete the team first); the personal org cascades with the account.

## Operational

- `pnpm tool:backfill-personal-orgs` — provisions the personal org for existing users lacking one
  (idempotent), for when `PERSONAL_ORGANIZATION_ENABLED` is turned on after launch.

## Route shape (active org = token claim)

The org-scoped routes are **flat**: they no longer carry a per-organization
path segment. The active organization rides the signed `org` token claim, so the active-org
resource is **singular** — `/api/v1/tenancy/organization` — with its sub-resources nested under it
(settings, logo, audit-logs, api-keys, notification-policies, memberships, roles, invitations,
leave, transfer-ownership). Other domains hang directly off the claim: `/api/v1/billing/subscriptions`,
`/api/v1/notify/webhooks`.

Account-level routes stay **plural** because they are not scoped to one active org:
`GET|POST /api/v1/tenancy/organizations` (list / create a team org),
`GET /api/v1/tenancy/organizations/by-slug/{slug}`, and the cross-org invitation actions
`POST /api/v1/tenancy/invitations/{invitation_id}/accept|decline`.

## Implementation status

Delivered: schema (`type`, nullable slug, partial index) · capability flags · personal-org
auto-provisioning (OAuth signup) · deletion guard · `/users/me` capabilities +
`personal_organization_id` · personal-org immutability · backfill · JWT `org`/`sv` claims · login
& refresh org-claim minting · `switch-to-personal` / `switch-to-organization` endpoints (e2e
tested) · **route flatten** — org-scoped routes dropped the per-organization path
segment in favour of the singular `/tenancy/organization` resource sourced from the `org` claim ·
permission layer + RLS sourced from the claim (per-request membership recheck, super-admin audited
bypass).

Planned (subsequent PRs): per-org-type capability matrix (enforce which capabilities each
`organizations.type` may use) · `sv` revocation wiring.
