---
name: seed-maintainer
description: Keeps domain seed data and orchestration scripts aligned with schemas and routes. Use after route, schema, or seed script changes.
---

# Seed maintainer (core-be)

## Purpose

Keep seed data domain-based and in sync with schemas and **routes**. Ensures seed data supports what the API exposes (route-level alignment).

## When to Use

- After adding/removing/updating **routes** or APIs (review and update seeds for route-level alignment)
- After adding new database tables or domains
- After changing schema columns that affect seed data
- When seed scripts fail or produce stale data
- When adding new test/demo data requirements

## When to seed (best practices)

- **Minimal seed**: Only bootstrap/reference data the app assumes exists (e.g. permission codes, plans). No users or orgs required for the app to start.
- **Full / demo seed**: Only create seed data when it is **required to exercise the API** — e.g. for load testing, manual testing, or demo flows. Seed the minimum set of tables needed to hit the routes you care about (users, orgs, memberships, etc.); do not seed every table.
- **Do not** seed all tables by default. Add seeds only for entities that support the routes and flows you need (including load-test scenarios). Skip high-volume or purely user-generated data (e.g. audit logs, events) unless a specific test needs it.

## Seed locations

- **Domain-owned**: `src/domains/<domain>/.../*.seed.ts` — each domain (or sub-domain) owns its entity seed logic and reference data. No cross-domain insert logic inside domains.
  - `src/domains/tenancy/sub-domains/permission/permission.seed.ts` — system permission codes, `seedPermissions()`
  - `src/domains/billing/sub-domains/plan/plan.seed.ts` — default plans, `seedPlans()`
  - `src/domains/user/user.seed.ts` — `seedUser()`, `seedDemoUser()`
  - `src/domains/tenancy/tenancy.seed.ts` — `seedOrganization()`, `seedRole()`, `seedMembership()`, `seedRolePermissions()`, `seedMemberInvitation()`
- **Orchestration and common flows**: `src/scripts/seed/minimal.ts`, `src/scripts/seed/full.ts` only. No entity lists or insert helpers here — only calls to domain seeds and cross-domain flows (e.g. add user to organization, send invite).
- **Shared for scripts**: `src/scripts/seed/helpers.ts` — re-exports like `closeDatabase` only. `src/scripts/seed/faker-data.ts` — faker helpers for full seed (reproducible demo data).

## Steps

1. **Identify which domain(s) own the entity** (user, org, plan, permission, invitation, etc.).
2. **Add or update `*.seed.ts` in that domain**; keep data and insert logic there. Use `generatePublicId()` for all `public_id` fields; use `onConflictDoNothing()` where applicable for idempotency. **Only add seed data for entities required to exercise the API** (e.g. for load testing or demo); do not seed every table.
3. **Update `minimal.ts`** if new permissions or base data is needed (call the domain seed; do not duplicate data in scripts/seed).
4. **Update `full.ts`** if demo/test data for the domain is needed — call domain seeds and implement common flows (add users to org, send invite) in orchestration.
5. **Order**: Seed permissions first, then plans, then users, then tenancy (orgs, roles, memberships, role_permissions, invitations).
6. **After route changes**: Run **route-catalog** to regenerate `docs/routes.txt`, and update seeds so new routes have data and deprecated routes’ seed data is removed or marked unused.
7. **Test**: Run `pnpm db:seed` and `pnpm db:seed:full`; run `pnpm typecheck`.

## Domain–permission mapping

Permission codes live in `src/domains/tenancy/sub-domains/permission/permission.seed.ts` (`SYSTEM_PERMISSIONS`). When adding a new domain that needs permissions, add the codes there and ensure they are assigned to admin/demo roles in `full.ts` via `seedRolePermissions()`.

- Tenancy, Billing, Notify, Audit, Upload (see permission.seed.ts for the full list).

## Seed function pattern

```typescript
// In domain: src/domains/<domain>/.../<resource>.seed.ts
export async function seedEntity(payload: Payload) {
  const [row] = await database
    .insert(entity)
    .values({
      public_id: generatePublicId(),
      ...payload,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}
```
