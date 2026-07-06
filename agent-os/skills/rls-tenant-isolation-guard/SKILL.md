---
name: rls-tenant-isolation-guard
description: Enforces Postgres Row-Level Security and tenant-isolation correctness in core-be — every tenant-owned table ENABLE + FORCE RLS with an org-scoped policy carrying both USING and WITH CHECK, the app.current_organization_id GUC set on every query path, workers using context wrappers (never calling getRequestDatabase), and tenant jobs carrying organizationPublicId. Use when adding or changing a *.schema.ts table, a migration touching RLS, a database context wrapper, tenant middleware, or any worker/processor that reads tenant data.
trigger: src/infrastructure/database/contexts/**, src/domains/**/*.worker.ts
triggerNote: DB context wrappers, workers, and RLS migrations — tenant isolation
---

# RLS / tenant-isolation guard

The single most failure-prone, security-critical surface in core-be: a missed `FORCE ROW LEVEL SECURITY`, a `USING`-only policy, or a GUC-less worker query is the difference between isolation and a **cross-org data leak**. This guard codifies the rules; the global tests (`src/tests/global/no-direct-db-in-services.global.test.ts`, `rls-context-network-isolation.global.test.ts`, the `EXPECTED_FORCE_RLS_TABLES` registry) catch violations. Follow this when touching any tenant data path.

## Mechanism (how isolation actually works)

- Postgres RLS policies read transaction-scoped GUCs via `current_setting('app.<key>', true)`. The org GUC is **`app.current_organization_id`** and holds the organization **`public_id`** (not the bigint PK). Tenant policies resolve it as `organization_id = (SELECT id FROM tenancy.organizations WHERE public_id = current_setting('app.current_organization_id', true))`.
- Because connections are pooled, the GUC is **always** set with `SET LOCAL` / `set_config(key, value, true)` inside a transaction, so it dies at COMMIT/ROLLBACK and never leaks across checkouts.
- **HTTP path:** the tenant middleware (`src/shared/middlewares/tenant/tenant.middleware.ts`) only maps `X-Organization-Id → request.organizationId`; it is **not** the RLS authority. The active org is the signed `org` JWT claim. The GUC is set per service unit-of-work by `withOrganizationDatabaseContext(organizationPublicId, cb)` (`src/infrastructure/database/contexts/organization-database.context.ts` → `withOrganizationContext`).
- **Worker path:** `src/worker.ts` sets `CORE_BE_RUNTIME=worker`. Context wrappers open a txn, set their GUC, pin the handle in AsyncLocalStorage, and pass a branded `WorkerContextDatabaseHandle`:
  - `withOrganizationContext` → `app.current_organization_id`
  - `withUserDatabaseContext` → `app.current_user_id`
  - `withGlobalRetentionCleanupDatabaseContext` → `app.global_retention_cleanup = 'true'`
  - `withSessionRetentionCleanupDatabaseContext` → `app.session_retention_cleanup = 'true'`
  - Job runners wrap these: `runTenantScopedWorkerJob` (reads `organizationPublicId`), `runUserScopedWorkerJob` (reads `userPublicId`), `runGlobalRetentionWorkerJob` — in `src/infrastructure/queue/worker-runtime/worker-processor.util.ts`.
- **Fail-closed guards:** `getRequestDatabase()` (`request-database.context.ts`) **throws `WorkerDatabaseContextError`** in worker runtime if no handle is pinned (instead of silently returning the GUC-less pool). `assertWorkerRlsGucSet` verifies the live `current_setting` matches the expected context. `assert-database-rls-safety.ts` (boot, hosted) throws if `DATABASE_URL` connects as a superuser / `BYPASSRLS` role — Postgres skips even FORCE RLS for those. Intended role: `core_be_app`.

## When this guard triggers

`src/domains/**/*.schema.ts` · `migrations/*.sql` (RLS DDL) · `src/infrastructure/database/contexts/**` · `src/infrastructure/database/utils/force-rls-tables.constants.ts` · `src/shared/middlewares/tenant/**` · `src/infrastructure/queue/worker-runtime/worker-processor.util.ts` · `src/domains/**/workers/**`, `*.worker.ts`, `*.processor.ts`.

## Enforcement checklist

When you add a **new table in a tenant-owned schema** (`tenancy`, `billing`, `notify`, `audit`, `upload`, or user-scoped `auth`) that holds an `organization_id` (or an org-reachable FK):

- [ ] `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
- [ ] `ALTER TABLE … FORCE ROW LEVEL SECURITY` — **without FORCE, the table-owning `core_be_app` role bypasses RLS → cross-org leak.**
- [ ] `CREATE POLICY … FOR ALL` with predicate `organization_id = (SELECT id FROM tenancy.organizations WHERE public_id = current_setting('app.current_organization_id', true)) OR current_setting('app.global_retention_cleanup', true) = 'true'`.
- [ ] **Writable tables define both `USING` and an explicit `WITH CHECK`.** A `USING`-only policy makes Postgres reuse `USING` for the write check — and since `USING` carries the `app.global_retention_cleanup` (and any `app.global_admin`) bypass, that bypass then leaks to INSERT/UPDATE, letting a retention/admin context plant a row in **any** tenant (audit #41 / H1). The explicit `WITH CHECK` MUST pin to the active-org GUC **without** the retention/admin bypass arm: `WITH CHECK (organization_id = (SELECT id FROM tenancy.organizations WHERE public_id = current_setting('app.current_organization_id', true)))`. Add it with `ALTER POLICY … WITH CHECK (…)` (no policy-gap) and mirror it in the schema `pgPolicy({ … withCheck })`.
- [ ] Keep the `app.global_retention_cleanup` escape clause **in `USING` only**, so the retention/tombstone worker can still SELECT/DELETE cross-tenant but can never write cross-tenant.
- [ ] Add the table to `EXPECTED_FORCE_RLS_TABLES` (`force-rls-tables.constants.ts`, alphabetical) — `diffForceRlsTables` asserts the live DB FORCE-RLS set matches exactly.

For **worker / processor** code touching tenant data:

- [ ] Never call `getRequestDatabase()` (returns the GUC-less pool; throws in worker runtime). Importing DB-handle types / `setLocalDatabaseConfig` from `request-database.context` is fine — bind the handle via a context wrapper or a `run*WorkerJob` runner.
- [ ] Tenant-scoped jobs carry `organizationPublicId` in the payload (typed `TenantScopedJobData`); user-scoped jobs carry `userPublicId`.
- [ ] Worker repositories accept an explicit `databaseHandle` (`createWorker*Repository(databaseHandle)`) — the nominal brand prevents passing the pool at compile time.
- [ ] **No external I/O (fetch / Stripe / S3 / Resend) inside a `with*DatabaseContext` callback** — it holds a pool checkout across the network round-trip (`rls-context-network-isolation.global.test.ts`).

For **`SECURITY DEFINER`** functions — the RLS-bypass resolvers across `auth` / `tenancy` / `billing` / `notify` (`grep -rl 'SECURITY DEFINER' migrations/` lists the current set; it grows over time): each one MUST pin `SET search_path` and `GRANT EXECUTE` only to `core_be_app`. Because the function bypasses RLS, **its body is the sole tenant/ownership boundary** — scope every query by the resolved id and return only the caller's rows.

### Reading / searching a FORCE-RLS column that lives on a *joined* table

A very common trap: the members list runs under **org-only** context (`app.current_organization_id` set, `app.current_user_id` NOT set), but member email / name live in `auth.users`, which is FORCE RLS behind a self-owner policy keyed on `app.current_user_id`. Under the non-superuser `core_be_app` role a plain `memberships JOIN auth.users` therefore resolves the auth.users policy to NULL and returns **ZERO rows** — the query silently matches nothing in production while passing under the RLS-exempt local/CI superuser (the exact trap behind 20260530000010 / 20260603120000 and the org-mandated-MFA bypass).

**Rule:** whenever a read/search/sort needs a column from a FORCE-RLS table that the current context can't satisfy (e.g. a user column under org context, or an org column before any tenant GUC exists), route it through a narrow SECURITY DEFINER resolver instead of a plain join. Prefer returning **only ids / the minimal columns** and let the caller's normal RLS-scoped, typed query apply the keyset + serialize — keeps typing, pagination, and the auth.users column exposure minimal.

- **Reference:** `tenancy.search_organization_membership_ids(org_id, pattern)` (migration `20260702000000`) returns matching membership **ids**; `MembershipRepository.findByOrganizationId` then filters its typed `(created_at,id)` keyset query with `id IN (...)`. Search term arrives pre-escaped via `buildContainsLikePattern` and matches with default `ESCAPE '\'`. Sibling read-only resolvers: `auth.resolve_user_summaries_by_ids`, `auth.resolve_user_public_ids_by_ids`, `tenancy.resolve_organization_default_locale`.
- **Test it as `core_be_app`, not the superuser.** Add a `src/tests/security/rls/*.security.test.ts` using `grantCoreBeAppRoleForTests` + `executeAsCoreBeAppTenant(orgPublicId, …)` that (a) shows the raw join is blocked to 0 rows [control], (b) shows the resolver returns the match, and (c) shows it never returns another org's row. A superuser-only db-unit test will pass even if the resolver is broken — it proves nothing about RLS. See `membership-search-resolver.security.test.ts`.

## Top failure modes

1. **`ENABLE` without `FORCE`** → table owner bypasses RLS → cross-org leak. (Tell: not added to `EXPECTED_FORCE_RLS_TABLES`.)
2. **`USING`-only policy on a writable table** → rows moved/planted into another tenant (no `WITH CHECK`).
3. **GUC-less query path** → RLS returns zero rows (silent broken query), or a dev "fixes" it by reaching for the unpinned pool → `WorkerDatabaseContextError`.
4. **Superuser/`BYPASSRLS` `DATABASE_URL`** → Postgres skips FORCE RLS silently; only caught on hosted by `assert-database-rls-safety`.
5. **DB context held across external I/O** → pool exhaustion under load.

## Verify

```bash
pnpm test:global        # no-direct-db-in-services + rls-context-network-isolation + force-rls registry
pnpm test:security      # src/tests/security/rls/**
pnpm db:migrate:lint    # migration safety
```

Related: [[workers-events]] (queue/worker patterns), [[sql-design-guard]] (schema design), [[db-migration-maintainer]] (migration authoring).
