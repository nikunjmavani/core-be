`src/infrastructure/database/`

# Database infrastructure

## Purpose

Postgres connection management, the abstract `BaseRepository` (with cursor pagination), the transactional helpers, the migration runner, the shared `pgSchema` definitions, and the **context family** that owns the platform's RLS contract — `withOrganizationContext`, `withUserDatabaseContext`, `withGlobalRetentionCleanupDatabaseContext`, etc. Domains never construct Drizzle clients themselves; they receive a `databaseHandle` from one of these contexts.

## Design decisions

- **Postgres over alternatives**: chosen for transactional guarantees, RLS, mature operational tooling, and the Drizzle ORM's typed query DSL. Multi-region failover is handled by the managed provider (Neon / RDS).
- **Drizzle 0.45 + the `postgres` 3.x driver**: `postgres` driver chosen over `pg` for native prepared-statement support, simpler connection-pool semantics, and much better performance under load.
- **`snake_case` column names everywhere**: enforced by convention; matches Postgres native style and avoids the case-folding pitfalls of mixed identifiers.
- **RLS is the defense-in-depth layer**: every tenant-scoped table has an RLS policy. The application is expected to filter by `organization_id`; RLS is what prevents a bug from leaking rows across tenants.
- **Context family pattern**: instead of per-call `SET LOCAL`, contexts open a Drizzle transaction, set the GUC once, and pass a pinned `databaseHandle` to a callback. Reuse semantics: a worker context inside an HTTP request (or vice versa) for the same organization reuses the active handle (no nested top-level transaction, no lost `SET LOCAL`).
- **Workers cannot use HTTP request DB context**: enforced by [contexts/worker-database-guard.util.ts](src/infrastructure/database/contexts/worker-database-guard.util.ts) and by global tests that scan `*.worker.ts` / `*.processor.ts` imports.
- **Connection budget**: [assert-connection-budget.ts](src/infrastructure/database/assert-connection-budget.ts) caps the per-process pool size against the managed Postgres tier limits.
- **Force-RLS table list** at [force-rls-tables.constants.ts](src/infrastructure/database/force-rls-tables.constants.ts): the migration linter rejects new tables that should be RLS-eligible but aren't in the list.

## Operational concerns

- **Statement timeout**: enforced via `DATABASE_STATEMENT_TIMEOUT_MS` (set on connection options); long-running queries are killed.
- **Pool sizing**: `DATABASE_POOL_SIZE` env. The `assert-connection-budget` helper warns at startup when the configured size exceeds the budget.
- **Checkout observability**: [organization-rls-checkout-counter.ts](src/infrastructure/database/organization-rls-checkout-counter.ts) tracks in-flight org-scoped RLS checkouts (both the `withOrganizationContext` unit-of-work and the legacy request-pinned transaction). It feeds the pool-exhaustion alerter and the `database_rls_active_checkouts` gauge + `database_rls_checkout_hold_seconds` histogram (see [observability runbook](docs/deployment/runbooks/observability.md)) so checkout starvation and over-long holds are caught before requests queue.
- **Partition maintenance**: `partition-maintenance.ts` + the partition-maintenance worker create future partitions and detach old ones for tables that are time-partitioned (e.g. audit logs).
- **Migrations** live under [migrations/](migrations/) at repo root; the runner is `pnpm db:migrate`. The lint check is `pnpm db:migrate:lint`.

## External dependencies

- **Postgres 16+** — production runs against managed Postgres. Local dev uses Docker Compose.

## Tuning parameters

- `DATABASE_URL`, `DATABASE_POOL_SIZE`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_RLS_SCOPED_CONTEXTS` (feature flag for the scoped-context model).

## Failure modes

- **Postgres unavailable** → connection probe fails; readiness `/health` returns 503; load balancer yanks traffic.
- **RLS GUC missing** (workers that forgot to use a context wrapper) → RLS policies treat the access as cross-tenant and return zero rows. Caught in tests; never reaches production.
- **Long-running query** → statement timeout fires; the query is killed and the request returns 5xx.
- **Multi-region replica lag** → the managed provider routes reads; this module does not split read/write.

## Related runbooks

- Postgres failover procedure (managed-provider docs).
- Migration replay / dry-run: `pnpm db:migrate:dry-run` and `pnpm db:migrate:lint`.
