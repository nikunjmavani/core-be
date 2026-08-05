# DB Viewer (local tooling)

Zero-dependency live ER diagram for Drizzle `*.schema.ts` files and hand-written `migrations/*.sql`.

Owned by this repo under `tooling/db-viewer` — same pattern as `tooling/dev/dashboards` and `tooling/setup` (module folder + co-located config, thin root script).

## Run

From the core-be root:

```bash
pnpm db:viewer
```

Opens http://127.0.0.1:4984 by default (loopback only — near Drizzle Studio on `:4983`).
The printed/opened URL carries a per-boot random session token that `/api/*` and `/events`
require (loopback is shared by every local process) — always use the URL the CLI gives you.

Optional overrides:

```bash
DB_VIEWER_PORT=4990 pnpm db:viewer
pnpm db:viewer -- --no-open
pnpm db:viewer -- --port 4990
```

### Deep review (optional)

`POST /api/review` spawns the local `claude` CLI. It is **off by default**.

```bash
DB_VIEWER_REVIEW=1 pnpm db:viewer
```

When enabled it still requires loopback bind, a local `Host`, a local `Origin` (if present), the per-boot session token, `Content-Type: application/json`, and at most one in-flight child. The child gets an allow-listed env (not your full `.env`) and a neutral cwd (`os.tmpdir()`), so schema text in the prompt cannot steer it into reading repo files.

## Config

`tooling/db-viewer/config.json` (co-located; not a root config file):

```json
{
  "name": "core-be",
  "schema": "./src",
  "migrations": "./migrations",
  "port": 4984
}
```

Paths are relative to the repo root. Port can also come from `DB_VIEWER_PORT` (local process env only — not in env-schema). A malformed config fails loud instead of silently falling back.

Runtime history (save mode) lands in `tooling/db-viewer/.db-viewer-history/` (gitignored in-module).

## Layout

```text
tooling/db-viewer/
  cli.mjs           # entry (pnpm db:viewer)
  server.mjs        # HTTP + watch + APIs (127.0.0.1)
  config.json       # co-located defaults
  lib/              # parser, SQL migrations, project resolve, diff, normalize
  public/           # static UI
  README.md
```
