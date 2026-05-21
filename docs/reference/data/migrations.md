# SQL migrations (core-be)

How schema changes ship, how CI guards them, and how to validate **rollback** without applying destructive DDL in production.

---

## Layout

| Path | Role |
| ---- | ---- |
| `migrations/*.sql` | Ordered, forward-only SQL applied by `pnpm db:migrate` |
| `src/domains/**/<resource>.schema.ts` | Drizzle definitions — must stay aligned with migrations |
| `src/scripts/validators/migration/lint-migrations.ts` | CI gate (`pnpm db:migrate:lint`) — destructive DDL, RLS, naming |

See **db-migration-maintainer** skill and [data-lifecycle-deletion.md](../data/data-lifecycle-deletion.md) when retention or `deleted_at` changes.

---

## Migration filename ordering

Each up migration file is named `YYYYMMDDHHMMSS_snake_case.sql`. The **14-digit prefix is a lexicographic sequence key**, not necessarily the calendar day the file was written.

- Applied migrations are recorded in `public.schema_migrations` by **filename** — never rename merged files.
- The prefix must be **strictly greater** than every existing up migration (`pnpm db:migrate:lint` enforces monotonic order).
- Historical mixes (for example `202502*` early schema, then `202602*`, then `202605*`) are valid; ordering is by prefix only.
- **Do not** rely on `date -u +%Y%m%d000001` unless you confirm it sorts after the current max. Example: on 2026-05-20, `20260520000001` is **less than** max `20260530000002` and will fail CI.

**Suggested next prefix:**

```bash
pnpm db:migrate:next-prefix add_my_table
# → prints current max, next prefix, and example filename
```

Then author SQL in `migrations/<prefix>_<snake_case>.sql` and run `pnpm db:migrate:lint`.

---

## Forward apply (local / CI)

```bash
pnpm db:migrate:lint   # safety rules
pnpm db:migrate        # apply pending files
pnpm db:migrate:dry-run  # print SQL without applying (when debugging)
```

CI and `pnpm verify:base` run migrate against ephemeral Postgres before API smoke tests.

---

## Rollback testing approach

Production deploys are **forward-only**: we do not run automatic down migrations on Railway. Rollback validation is done **before merge** using one of these patterns:

### 1. Neon branch rehearsal (recommended)

1. Create a disposable Neon branch from production (or staging) schema.
2. Apply the PR migration: `DATABASE_URL=<branch> pnpm db:migrate`.
3. Run targeted Vitest integration tests and `pnpm test:api-smoke` against the branch.
4. **Simulate rollback** by restoring the branch to a PITR timestamp **before** the migration (Neon console) or by creating a fresh branch from the old snapshot.
5. Redeploy application code at the **previous git tag** against the restored branch and re-run smoke tests.

This validates **RPO/RTO** assumptions in [dr-runbook.md](../../process/dr-runbook.md) without mutating production.

### 2. Local two-step apply

1. `pnpm compose:up && pnpm compose:wait`
2. Migrate to revision *N*: `pnpm db:migrate`
3. Capture schema dump: `pg_dump --schema-only … > /tmp/before.sql`
4. Apply revision *N+1* (the PR migration).
5. Confirm app tests pass at *N+1*.
6. **Logical rollback**: reset DB (`docker compose down -v`, up, migrate only through *N*) and confirm the previous app commit still works — proves the old code path does not require new columns.

### 3. Compensating migration (production rollback)

When a migration already reached production and must be reversed:

1. Ship a **new** forward migration that undoes the effect (drop column added in error, restore constraint, etc.).
2. Never edit merged `migrations/*.sql` files.
3. Run `pnpm db:migrate:lint` with explicit `--allow-destructive` only when architect-approved.

---

## Transaction rollback (CI)

Postgres transaction rollback for multi-write helpers is covered in CI by:

```bash
pnpm test:integration:transaction-rollback
```

(`src/tests/integration/transaction-rollback.integration.test.ts` — asserts `withTransaction` rolls back on error and commits on success.) This is **not** SQL migration rollback.

---

## Automated migration rollback test stub (future)

A dedicated Vitest project (`migrations-rollback`) is **not** wired in CI today — Neon branch rehearsal is the supported path. If we add automation later, it should:

- Spin up Testcontainers Postgres
- Apply `migrations/` through file *N*, run a minimal schema assertion
- Apply *N+1*, assert new invariant
- Reset volume and re-apply through *N* only, assert old invariant

Until then, document rollback evidence in the PR (Neon branch name + smoke command output).

---

## ER diagram (dbdiagram.io)

Regenerate [DBML](https://dbml.dbdiagram.io/docs) from **all** `migrations/*.sql` (replay in filename order):

```bash
pnpm tool:generate-dbdiagram
```

Output: [`docs/database/core-be.dbml`](../../database/core-be.dbml) — import at [dbdiagram.io](https://dbdiagram.io/) (File → Import).

The file includes:

- **Primary keys** (`pk`, `increment`, composite `indexes { ... [pk] }` for partitioned tables)
- **Foreign keys** as `Ref:` lines with `delete: cascade | restrict | set null` where defined in SQL
- **RLS** as per-table `Note` blocks (policies from `CREATE POLICY` migrations)
- **TableGroup** per Postgres schema (`auth`, `tenancy`, `billing`, …)

Dropped tables from earlier schema consolidations are omitted from the cumulative model — Stripe is the source of truth for billing documents and payment instruments.

---

## Related commands

| Command | Purpose |
| ------- | ------- |
| `pnpm db:migrate:lint` | Block unsafe DDL in CI |
| `pnpm db:migrate:next-prefix` | Print next filename prefix after current max |
| `pnpm db:migrate:dry-run` | Inspect pending SQL |
| `pnpm tool:generate-dbdiagram` | Regenerate `docs/database/core-be.dbml` for dbdiagram.io |
| `pnpm verify:base` | migrate → seed → API smoke |
