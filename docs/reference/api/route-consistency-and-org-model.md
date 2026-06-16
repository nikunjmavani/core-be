# Route consistency & the personal/team organization model

How the public API stays consistent, and how a single route surface serves both
**personal** and **team** organizations. Companion to
[response-codes.md](./response-codes.md) and the
[api-contract-guard skill](../../../agent-os/skills/api-contract-guard/SKILL.md).

---

## 1. One surface, two organization types

Every authenticated request acts on **one active organization**, carried by the
signed `org` JWT claim (switch with `POST /auth/switch-to-personal` /
`POST /auth/switch-to-organization`). There is intentionally **no** `/personal/*`
vs `/team/*` fork — both types use the same `/api/v1/tenancy/organization/*`
routes. The difference is behavioural, enforced in the service layer.

A **personal** organization (`type: "PERSONAL"`) is a single-member, slug-less,
immutable workspace auto-provisioned at signup. A **team** organization
(`type: "TEAM"`) is shareable: members, invitations, custom roles, ownership
transfer, and deletion.

### Capability matrix

| Capability | TEAM | PERSONAL | Service guard |
| ---------- | :--: | :------: | ------------- |
| Invite members (`POST …/invitations`) | ✅ | ❌ 422 | `member-invitation.service.ts` |
| Add member (`POST …/memberships`) | ✅ | ❌ 422 | `membership.service.ts` |
| Custom roles (`POST …/roles`) | ✅ | ❌ 422 | `member-role.service.ts` |
| Transfer ownership (`POST …/transfer-ownership`) | ✅ | ❌ 422 | `membership.service.ts` |
| Delete organization (`DELETE …/organization`) | ✅ | ❌ 422 | `organization.service.ts` |
| Settings, notification-policies, API keys, subscriptions, webhooks, audit-logs | ✅ | ✅ | — |
| Has a `slug` / appears in `GET /organizations` | ✅ | ❌ (slug `null`) | schema |

The five blocked actions reject a personal org with **422** (the org `type` is
immutable, so retrying always fails — see the 409-vs-422 rule in
[response-codes.md](./response-codes.md)), carrying i18n keys
`errors:personalOrganizationNoMembers` / `NoRoles` / `Immutable`.

## 2. Capability discovery — the `capabilities` object

So clients and agents don't learn the matrix by trial-and-error (or by hitting
422s), every organization response embeds a type-derived `capabilities` object
(produced by `organizationCapabilities()` in `organization.serializer.ts`):

```jsonc
// GET /api/v1/tenancy/organization
{ "data": {
    "id": "org_…", "type": "personal", "slug": null,
    "capabilities": {
      "can_invite_members":     false,
      "can_manage_members":     false,
      "can_manage_roles":       false,
      "can_transfer_ownership": false,
      "can_delete":             false
    }
} }
```

A team org returns the same keys all `true`. **Capabilities reflect the
organization *type*, not the caller's permissions** — a team member lacking
`invitation:manage` still sees `can_invite_members: true` (the org supports it;
their permission is enforced separately and surfaces as 403).

## 3. The `/auth/me/*` self-service namespace

Everything that acts on *your own* account lives under `/auth/me/*` (and
`/users/me/*` for profile). This includes auth methods, sessions, **MFA**
(`/auth/me/mfa…`), and **passkey registration** (`/auth/me/webauthn/register/…`).
Public login-flow routes are NOT under `/me`: `POST /auth/mfa/login`,
`POST /auth/webauthn/authenticate/{options,verify}`.

## 4. The self-describing route catalog (`docs/routes.txt`)

`pnpm routes:catalog` regenerates `docs/routes.txt`. Each route line carries
four machine-readable facets so humans and agents can answer the common
questions at a glance:

```text
  METHOD PATH<padded>                                   <status> <idem> <org> ACCESS
  POST   /api/v1/tenancy/organization/invitations        201      req    team  PERM: invitation:manage
```

- **status** — documented happy-path status (from `route-success-statuses.json`).
- **idem** — `req` when `config.idempotencyRequired`, else `-` (auto-detected).
- **org** — `team` (422 on a personal org) or `both`.
- **ACCESS** is always the last column (it may contain spaces/commas).

Three auto-generated footer sections list the **idempotency-required writes**,
the **team-only routes**, and the **deprecated routes** (Sunset/Deprecation
headers). Sources of truth:

| Facet | Source | Guard |
| ----- | ------ | ----- |
| success status | `tooling/openapi/route-catalog/route-success-statuses.json` | `pnpm validate:route-success-statuses` |
| idempotency / deprecation | route snippet (`config.idempotencyRequired`, `applyDeprecatedEndpointHeaders`) | regenerate + `routes:catalog:check` |
| org scope | `tooling/openapi/route-catalog/org-scope.ts` (`TEAM_ONLY_ROUTE_KEYS`) | `route-catalog-org-scope.unit.test.ts` |
| schema docs (summary/description/tags) | each `*.routes.ts` registration | `pnpm validate:route-schema-docs` |

## 5. Adding or changing a route — checklist

1. Pick the success status from the method table; add the
   `route-success-statuses.json` entry.
2. If the route is rejected on a personal org, add its key to
   `TEAM_ONLY_ROUTE_KEYS` (and a service-layer 422 guard).
3. Give the registration a full `schema: { summary, description, tags }`.
4. `pnpm routes:catalog` → review the new line + footer sections.
5. Gates: `pnpm validate:route-success-statuses`, `pnpm validate:route-schema-docs`,
   `pnpm routes:catalog:check`, then `pnpm docs:generate:multilang && pnpm docs:check`.
