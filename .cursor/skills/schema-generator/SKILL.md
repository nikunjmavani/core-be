# Skill: Schema Generator

## Purpose

Generate co-located Drizzle schema files for new domains or sub-domains, following core-be conventions (snake_case columns, co-located in domain folder, pgSchema from `pg-schemas.ts`).

## When to Use

- When creating a new domain or sub-domain that requires database tables
- When adding new tables to an existing domain
- Triggered automatically by `sql-design-guard-sync.mdc` when `*.schema.ts` changes

## Prerequisites

- `src/infrastructure/database/pg-schemas.ts` exists with the domain's `pgSchema` definition
- The domain folder exists under `src/domains/<domain>/`

## Steps

1. **Determine the Postgres schema** from `pg-schemas.ts` (auth, tenancy, billing, notify, audit).
2. **Create `<sub-domain>.schema.ts`** in the domain/sub-domain folder (e.g. `src/domains/tenancy/sub-domains/organization/organization.schema.ts`).
3. **Follow column conventions**:
   - Use `snake_case` for all column property names
   - Standard columns: `id` (bigserial PK), `public_id` (`text`, unique, not null, with `CHECK (char_length(public_id) = 21)` for nanoid), `created_at`, `updated_at` (timestamp with timezone, defaultNow)
   - Soft-delete: `deleted_at` (nullable timestamp)
   - Audit: `created_by_user_id`, `updated_by_user_id` (bigint, nullable)
   - **Strings**: use `text` everywhere — never `varchar(n)`. Enforce real length/format limits with `CHECK` constraints. See `sql-design-guard` section C.
   - **Case-insensitive lookups**: default to `text` + a unique/regular index on `lower(column)`. Only use `citext` when `lower()` indexes don't fit (case-insensitive `LIKE` / joins) and document why.
   - **Encoding**: rely on the default UTF-8 database encoding — do not set per-column collation unless documented.
4. **Run sql-design-guard** on the new/changed schema (indexes, constraints, naming).
5. **Add SQL migration** via **db-migration-maintainer** — hand-written `migrations/<timestamp>_*.sql` or reviewed `drizzle-kit generate` output; then `pnpm db:migrate`.
6. **Confirm `drizzle.config.ts`** includes `src/domains/**/*.schema.ts` (default).
7. **Run `pnpm typecheck`** to verify.

## Schema Template

```typescript
import {
  bigserial,
  bigint,
  check,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { <domain>Schema } from '@/infrastructure/database/pg-schemas.js';

export const <table_name> = <domain>Schema.table(
  '<table_name>',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    public_id: text('public_id').notNull().unique(),
    // ... domain-specific columns (use `text`, not varchar) ...
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    created_by_user_id: bigint('created_by_user_id', { mode: 'number' }),
  },
  (table) => ({
    chk_public_id_length: check(
      'chk_<table_name>_public_id_length',
      sql`char_length(${table.public_id}) = 21`,
    ),
  }),
);
```

## Naming Convention

- File: `src/domains/<domain>/<sub-domain>/<sub-domain>.schema.ts`
- Table name: plural, snake_case (e.g., `organizations`, `webhook_events`, `auth_sessions`)
- Column names: snake_case, matching actual Postgres column names exactly

## Related skills

- **sql-design-guard** — design-quality review after scaffolding
- **db-migration-maintainer** — SQL in `migrations/`
- **seed-maintainer** — demo/reference data when routes need it
- **tsdoc-export-guard** — TSDoc summary on every exported `pgTable`, type, and inferred row type in the new schema file
- **feature-doc-maintainer** — refresh per-folder `DOCS.md` after adding the schema file
