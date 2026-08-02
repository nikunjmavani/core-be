# schema·board (vendored)

Zero-dependency live ER diagram for Drizzle schemas + SQL migration history.

Owned by this repo under `tooling/schema-board` — no external package required.

## Run (from core-be root)

```bash
pnpm schema-board
# or:
node tooling/schema-board/bin/schema-board.js
```

Reads `schema-board.config.json` at the project root (`schema` + `migrations`).

## Reuse in another project

Copy this folder + add a root config:

```json
{
  "name": "my-app",
  "schema": "./src",
  "migrations": "./migrations",
  "port": 4000
}
```

```json
{
  "scripts": {
    "schema-board": "node ./tooling/schema-board/bin/schema-board.js"
  }
}
```
