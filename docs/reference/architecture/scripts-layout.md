# Scripts layout (`src/scripts/`)

Build-time and operational scripts live under `src/scripts/`, grouped by concern. **Do not add `*.ts` files at `src/scripts/` root** — CI enforces this via `pnpm validate:scripts-layout`.

## Categories

| Folder | Purpose | Examples |
| ------ | ------- | -------- |
| `codegen/` | OpenAPI, Postman, route catalog, project tree, docs drift checks | `generate-openapi.ts`, `check-api-docs-sync.ts` |
| `validators/` | CI gates, env example sync, migration lint, doc link checks | `validate-domain.ts`, `sync-env-example.ts`, `lint-migrations.ts` |
| `admin/` | Operator tools, secrets, DLQ replay, worker probes | `admin-token.ts`, `dlq-replay.ts`, `worker-health.ts` |
| `ops/` | Smoke tests, verify gate, contract fixture recording, soak tests | `verify-base.ts`, `api-smoke-test.ts` |
| `seed/` | Database seed orchestration (minimal / full / demo sync) | `minimal.ts`, `full.ts` |
| `tooling/` | One-off codemods and repo maintenance | `codemod-test-suffixes.ts` |

## When to add a script

1. Pick the category that matches **why** the script runs (generation, validation, admin, ops, seed, or tooling).
2. Add a `pnpm` script in `package.json` pointing at `tsx src/scripts/<category>/<name>.ts`.
3. Prefer `@/` imports and `process.cwd()` for repo paths; use `import.meta.dirname` only when resolving paths relative to the script file (adjust `../` depth for nested folders).
4. Run `pnpm validate:scripts-layout` locally before pushing.

## Related commands

| Command | Script |
| ------- | ------ |
| `pnpm validate:scripts-layout` | Asserts zero `src/scripts/*.ts` root files |
| `pnpm ci:quality` | Includes scripts layout check |
| `pnpm tool:project-structure-tree` | `codegen/generate-project-structure-tree.ts` |
| `pnpm verify:base` | `ops/verify-base.ts` |

See also [project-structure-guide.md](./project-structure-guide.md) and `CLAUDE.md` § Commands.
