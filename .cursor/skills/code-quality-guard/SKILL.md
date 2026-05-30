---
name: code-quality-guard
description: Maintains the 3-layer code quality and security pipeline (editor Biome, Husky pre-commit hooks, CI security scanning). Use after changing Biome rules, pre-commit hooks, CI workflows, lint-staged config, or adding new security tooling.
---

# Code quality guard (core-be)

Maintains the layered code quality and security checking pipeline. Run this skill after any change to linting rules, pre-commit hooks, CI security steps, or related config files.

## Architecture: 3 layers

```text
Layer 1 (Editor)  -- Biome extension gives real-time lint + format while coding
Layer 2 (Pre-commit) -- Husky runs lint-staged (Biome), typecheck, Gitleaks, guards
Layer 3 (CI)      -- Full validation, Semgrep SAST, Gitleaks full-repo, tests
```

## Config files and their roles

| File                                | Layer | Purpose                                                                                                                                                                                                       |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biome.json`                        | 1 + 2 | Biome lint + format rules and per-path overrides                                                                                                                                                              |
| `.biomeignore`                      | 1 + 2 | Paths Biome skips (e.g. migrations, lockfile)                                                                                                                                                                 |
| `.vscode/settings.json`             | 1     | Editor format on save, Biome fix on save                                                                                                                                                                      |
| `.husky/pre-commit`                 | 2     | Pre-commit hook script (subset of CI quality job; fast local sync gate)                                                                                                                                       |
| `.husky/pre-push`                   | 2     | Pre-push: typecheck, build, build:check, unit tests                                                                                                                                                           |
| `.husky/commit-msg`                 | 2     | Validates commit messages with commitlint (conventional commits)                                                                                                                                              |
| `commitlint.config.cjs`             | 2 + 3 | Commitlint rules (extends `@commitlint/config-conventional`); same config as CI on push to `main`                                                                                                             |
| `package.json` `lint-staged`        | 2     | Which files get linted/formatted on commit                                                                                                                                                                    |
| `.gitleaks.toml`                    | 2 + 3 | Gitleaks allowlist (ignored paths)                                                                                                                                                                            |
| `.semgrepignore`                    | 3     | Semgrep ignored paths in CI                                                                                                                                                                                   |
| `.github/workflows/ci.yml`          | 3     | CI jobs: `quality` (validate + Gitleaks + Semgrep), `test` (full Vitest + coverage), `api-smoke` (migrate + full seed + live server + `pnpm test:api-smoke`), `chaos-testing` (Toxiproxy + `pnpm test:chaos`) |
| `.github/workflows/commit-lint.yml` | 3     | Commitlint on every push to `main`                                                                                                                                                                            |

## When to run this skill

- Adding or changing Biome rules in `biome.json`
- Modifying `.husky/pre-commit` hook steps
- Adding `.husky/commit-msg` or changing commitlint config
- Changing `lint-staged` config in `package.json`
- Adding or updating CI security jobs
- Adding new code quality tooling

## Layer 1: Editor (real-time while coding)

### Biome (`@biomejs/biome` devDependency)

| Area        | Examples in `biome.json`                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- |
| Correctness | `noUnusedVariables`, `noExplicitAny`                                                     |
| Style       | `useConst`, `useImportType`, `noParameterAssign`                                       |
| Complexity  | `noExcessiveCognitiveComplexity`, `noExcessiveLinesPerFunction`                        |
| Security    | `noGlobalEval`, `noImpliedEval` (nursery)                                                |

Architectural import restrictions previously in ESLint (`no-restricted-imports`, `no-restricted-syntax`) are enforced by global tests (e.g. `external-sdk-coverage.global.test.ts`, worker RLS security tests) and code review.

### VS Code settings (`.vscode/settings.json`)

Must include:

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.codeActionsOnSave": { "source.fixAll.biome": "explicit" }
}
```

Extension: `biomejs.biome` (see `.vscode/extensions.json`).

## Layer 2: Pre-commit (`.husky/pre-commit`)

The hook runs sequential checks. If any fail, the commit is rejected. See **before-commit-guard** when the user reports a failed commit.

Pre-commit mirrors a **subset** of the static checks in [`.github/workflows/pr-ci.yml`](../../../.github/workflows/pr-ci.yml). CI additionally runs `deps:audit`, full-repo `pnpm validate`, `validate:domain:coverage`, always-on `db:migrate:lint`, `test:contract`, Semgrep, and full-repo Gitleaks.

| Step | Command                                                                                   | What it catches                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm lint-staged`                                                                        | Biome on staged `src/**/*.ts`, `tooling/**/*.{ts,mjs}`; Biome format on `*.{json,yaml,yml}`; markdownlint on `*.md`                                                  |
| 2    | `pnpm typecheck`                                                                          | TypeScript type errors in `src/`                                                                                                                                     |
| 3    | `pnpm validate:domain:strict`                                                             | Domain structure (canonical layout, routes; warnings fail)                                                                                                           |
| 4a   | `pnpm routes:catalog` + stage `docs/routes.txt`                                          | Stale route catalog; local commits always regenerate and stage the checked-in catalog before push                                                                     |
| 4b   | When routes or OpenAPI inputs staged: `pnpm docs:check`                                   | Stale gitignored `docs/openapi/*.json` or `docs/postman-collection.json` vs generator (`tooling/openapi/**`, locale openapi files, codegen scripts)                  |
| 4c   | Always: `pnpm routes:catalog:check`                                                       | Route catalog/registry out of sync after regeneration                                                                                                                |
| 5    | `pnpm db:migrate:lint` (only when staged `migrations/*.sql`)                              | Unsafe SQL DDL patterns (`NOT NULL` add without default, `RENAME`, locking indexes, FK/CHECK without `NOT VALID`, missing `IF NOT EXISTS`, destructive `DROP TABLE`) |
| 6    | `pnpm tool:sync-env-example`                                                              | `.env.example` drift vs env schema (same as CI)                                                                                                                      |
| 7    | `gitleaks protect --staged`                                                               | Secrets in staged files (skipped if gitleaks CLI not installed; CI always scans)                                                                                     |
| 8    | grep for conflict markers                                                                 | Accidental `<<<<<<<` / `>>>>>>>` in staged files                                                                                                                     |
| 9    | git cat-file size check (`--diff-filter=ACMRT`)                                           | Added/copied/modified/renamed files > 1MB in staged changes                                                                                                          |

### Pre-push (`.husky/pre-push`)

| Step | Command            | What it catches                    |
| ---- | ------------------ | ---------------------------------- |
| 1    | `pnpm typecheck`   | Type errors before push            |
| 2    | `pnpm build`       | Compile failures                   |
| 3    | `pnpm build:check` | Unresolved `@/` aliases in `dist/` |
| 4    | `pnpm test:unit`   | Failing shared unit tests          |

### Commit message hook (`.husky/commit-msg`)

| Step | Command                            | What it catches                                                                                              |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | `pnpm exec commitlint --edit "$1"` | Non–conventional-commit messages (same rules as push workflow `.github/workflows/commit-lint.yml` on `main`) |

### lint-staged config (`package.json`)

```json
"lint-staged": {
  "src/**/*.ts": ["biome check --write --no-errors-on-unmatched"],
  "tooling/**/*.{ts,mjs}": ["biome check --write --no-errors-on-unmatched"],
  "*.{json,yaml,yml}": ["biome format --write --no-errors-on-unmatched"],
  "*.md": ["markdownlint-cli2 --config .markdownlint.json --fix"]
}
```

## Layer 3: CI (`.github/workflows/ci.yml`)

### `quality` job — validate + static security

- **Dependency audit**: `pnpm audit` runs after install; the pipeline **fails on any vulnerability** (no audit-level filter). Keep dependencies and `pnpm.overrides` so that `pnpm audit` passes. See **dependency-security** skill when changing `package.json` or `pnpm-lock.yaml`.
- **Migration safety lint**: `pnpm db:migrate:lint` scans `migrations/*.sql` for zero-downtime-unsafe patterns (same command as pre-commit when SQL migrations are staged).
- **Gitleaks + Semgrep** run in the same job after validate steps (one checkout; no duplicate `security-tests` Vitest job — security tests are in `test:coverage`).

| Step | Tool                          | What it catches                                         |
| ---- | ----------------------------- | ------------------------------------------------------- |
| 1    | `gitleaks` CLI (binary, v8)   | Full-repo secret scan (AWS keys, tokens, passwords)     |
| 2    | `semgrep scan --config auto`  | SAST: SQL injection, XSS, insecure crypto, OWASP Top 10 |

### `test` job (runs after `quality` passes)

- Postgres + Redis service containers → `pnpm db:migrate` → `pnpm test:coverage` (includes security, performance, e2e, integration, unit).

### `api-smoke` job (runs after `quality` passes)

- Postgres + Redis service containers → `pnpm db:migrate` → `pnpm db:seed:full` → background `pnpm tsx src/server.ts` → wait for `/readyz` → `pnpm test:api-smoke`. Catches route/DI wiring regressions against real HTTP.

### Supporting ignore files

- `.gitleaks.toml` -- paths Gitleaks skips (node_modules, .env.example, lock files, generated docs)
- `.semgrepignore` -- paths Semgrep skips (node_modules, dist, migrations, lock files)

## Convenience scripts (`package.json`)

| Script                  | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `pnpm security:secrets` | Manual full-repo Gitleaks scan (requires `gitleaks` CLI) |
| `pnpm security:sast`    | Manual Semgrep scan (requires `semgrep` CLI)             |
| `pnpm validate`         | biome check + typecheck (same as CI)                     |
| `pnpm lint`             | `biome check src tooling`                                |
| `pnpm format`           | `biome format --write src tooling`                       |

## Checklist (run after changes)

1. **Biome config valid?** -- run `pnpm lint` and confirm no config errors
2. **Pre-commit hook executable?** -- `.husky/pre-commit` must have execute permission
3. **lint-staged patterns correct?** -- ensure patterns match actual file locations
4. **CI workflow valid YAML?** -- check `.github/workflows/ci.yml` syntax
5. **Ignore files up to date?** -- `.gitleaks.toml` and `.semgrepignore` include new generated/vendor paths
6. **VS Code settings preserved?** -- Biome default formatter + `source.fixAll.biome` on save
7. **Dependencies installed?** -- `@biomejs/biome` in devDependencies; no `eslint` / `prettier` packages

## Adding new Biome rules

1. Edit `biome.json` (use `overrides` for tests, scripts, tooling paths)
2. Run `pnpm lint` to verify no false positives on existing code
3. Update this skill's Layer 1 tables above

When adding a new pre-commit check:

1. Add the check to `.husky/pre-commit` (sequential, fail-fast)
2. Update this skill's Layer 2 table above
3. Test with a manual commit
