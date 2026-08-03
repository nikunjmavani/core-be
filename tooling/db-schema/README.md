# db schema (local tooling)

Zero-dependency live ER diagram for Drizzle `*.schema.ts` files and hand-written `migrations/*.sql`.

Owned by this repo under `tooling/db-schema` — same pattern as `tooling/dev/dashboards` and `tooling/setup` (module folder + co-located config, thin root script).

## Run

From the core-be root:

```bash
pnpm db:schema
```

Opens http://localhost:4984 by default (near Drizzle Studio on `:4983`).

Optional overrides:

```bash
DB_SCHEMA_PORT=4990 pnpm db:schema
pnpm db:schema -- --no-open
pnpm db:schema -- --port 4990
```

## Config

`tooling/db-schema/config.json` (co-located; not a root config file):

```json
{
  "name": "core-be",
  "schema": "./src",
  "migrations": "./migrations",
  "port": 4984
}
```

Paths are relative to the repo root. Port can also come from `DB_SCHEMA_PORT` (local process env only — not in env-schema).

Runtime history (save mode) lands in `tooling/db-schema/.history/` (gitignored in-module).

## Layout

```text
tooling/db-schema/
  cli.mjs           # entry (pnpm db:schema)
  server.mjs        # HTTP + watch + APIs
  config.json       # co-located defaults
  lib/              # parser, SQL migrations, project resolve, diff
  public/           # static UI
  README.md
```
