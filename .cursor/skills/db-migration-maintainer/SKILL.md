---
name: db-migration-maintainer
description: Keeps SQL migrations in migrations/ aligned with Drizzle schema changes. Use when adding or changing *.schema.ts or creating/editing migrations/*.sql. Not for Supabase Edge Function porting (see supabase-porting).
---

# DB Migration Maintainer (core-be)

## Purpose

Postgres schema changes require **both** a co-located Drizzle `*.schema.ts` and a **versioned SQL file** under `migrations/`. This skill owns the SQL migration workflow. For Supabase → Node porting, use **supabase-porting** instead.

## When to use

- Created or modified `src/domains/**/*.schema.ts`
- Added or edited `migrations/*.sql`
- User asks to add a table/column/index in production

## Prerequisites

- Drizzle schema uses `pgSchema` from `src/infrastructure/database/pg-schemas.ts`
- `drizzle.config.ts` glob: `src/domains/**/*.schema.ts`
- Migrations applied via `pnpm db:migrate` (`src/infrastructure/database/migrate.ts`)

## Workflow

1. **Update Drizzle schema** in the domain/sub-domain folder (`<resource>.schema.ts`).
2. **Run sql-design-guard** on the schema (indexes, constraints, naming).
3. **Author SQL migration** in `migrations/`:
   - Filename: `YYYYMMDDHHMMSS_short_description.sql` — **14-digit lexicographic ordering key** + snake_case suffix (e.g. `20260520000001_system_tables_rls_deny_all.sql`).
   - Prefix must be **strictly greater** than every existing up-migration prefix (`pnpm db:migrate:lint` enforces monotonic order). Run **`pnpm db:migrate:next-prefix`** for the suggested prefix — do not use `date -u +%Y%m%d` unless it sorts after the current max (see [migrations.md](../../../docs/reference/data/migrations.md#migration-filename-ordering)).
   - **Do not rename** applied migration files — `public.schema_migrations` keys on `filename`.
   - Historical mixes of `202502*` and `202605*` prefixes are intentional; ordering is by prefix, not calendar “when written.”
   - One logical change per file when possible (add table, add column, add index).
   - Use schema-qualified names: `tenancy.organizations`, `auth.users`, etc.
   - Include `IF NOT EXISTS` / safe patterns where re-run risk exists; migrations are tracked in `public.schema_migrations` and run once.
4. **RLS**: if the table is tenant-scoped, add or update RLS policies in the same or follow-up migration (see existing `migrations/*_enable_rls.sql` patterns).
5. **`pnpm db:migrate:lint`** (required in CI): filename/timestamp ordering (`migration_filename_format`, `migration_timestamp_not_monotonic`) plus unsafe SQL patterns (`NOT NULL` without default when adding columns, `RENAME`, `DROP TABLE`/column destructive moves, locking `CREATE INDEX` without `CONCURRENTLY`, FK/CHECK additions without `NOT VALID`, missing `IF NOT EXISTS` on `CREATE TABLE` / `CREATE INDEX` / `CREATE SCHEMA`). Run after editing SQL migrations.
   - **Overrides** — only in the first 20 lines of a file:
     `-- migration-safety: allow <rule_id> reason="short justification"`
     Known `rule_id` values live in `migrationSafetyRuleIds` in [`src/scripts/validators/migration/lint-migrations.ts`](../../../src/scripts/validators/migration/lint-migrations.ts).
6. **Verify locally**:
   ```bash
   pnpm db:migrate:lint
   pnpm db:migrate
   pnpm typecheck
   ```
7. **Seeds**: if new tables need reference/demo data, invoke **seed-maintainer**.

## Drizzle Kit (optional)

- `drizzle-kit generate` can draft SQL from schema drift; **review every statement** before committing.
- Hand-written migrations are preferred when RLS, data backfills, or partial deploys need explicit control.

## Naming and layout

| Artifact         | Location                                                   |
| ---------------- | ---------------------------------------------------------- |
| Drizzle schema   | `src/domains/<domain>/<sub-domain>/<sub-domain>.schema.ts` |
| SQL migration    | `migrations/<timestamp>_<snake_case>.sql`                  |
| Migration runner | `src/infrastructure/database/migrate.ts`                   |

## Checklist

- [ ] Schema and SQL migration both updated
- [ ] Migration filename sorts after existing files
- [ ] Foreign keys reference correct schema.table
- [ ] Indexes named consistently (`idx_<table>_<columns>`)
- [ ] `pnpm db:migrate` succeeds on a clean DB after prior migrations
- [ ] `pnpm db:migrate:lint` passes
- [ ] **seed-maintainer** if routes/seeds need new data

## Anti-patterns

- Changing only `*.schema.ts` without a migration (production drift)
- Putting Drizzle schemas under `src/infrastructure/database/schemas/` (use domain co-location)
- Confusing this skill with **supabase-porting** (Edge Functions → Fastify)
