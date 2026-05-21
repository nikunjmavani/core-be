---
name: code-quality-guard
description: Maintains the 3-layer code quality and security pipeline (editor ESLint plugins, Husky pre-commit hooks, CI security scanning). Use after changing ESLint rules, pre-commit hooks, CI workflows, lint-staged config, or adding new security tooling.
---

# Code Quality Guard (core-be)

Maintains the layered code quality and security checking pipeline. Run this skill after any change to linting rules, pre-commit hooks, CI security steps, or related config files.

## Architecture: 3 layers

```
Layer 1 (Editor)  -- ESLint plugins give real-time feedback while coding
Layer 2 (Pre-commit) -- Husky runs lint-staged, typecheck, Gitleaks, guards
Layer 3 (CI)      -- Full validation, Semgrep SAST, Gitleaks full-repo, tests
```

## Config files and their roles

| File                                | Layer | Purpose                                                                                                                                                                                                       |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint.config.mjs`                 | 1 + 2 | ESLint rules (TypeScript, sonarjs code smells, security plugin)                                                                                                                                               |
| `.prettierrc`                       | 1 + 2 | Formatting rules                                                                                                                                                                                              |
| `.prettierignore`                   | 1 + 2 | Files Prettier skips                                                                                                                                                                                          |
| `.vscode/settings.json`             | 1     | Editor auto-fix on save, ESLint validation                                                                                                                                                                    |
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

- Adding or changing ESLint rules or plugins
- Modifying `.husky/pre-commit` hook steps
- Adding `.husky/commit-msg` or changing commitlint config
- Changing `lint-staged` config in `package.json`
- Adding or updating CI security jobs
- Adding new code quality tooling

## Layer 1: Editor (real-time while coding)

### ESLint plugins (installed as devDependencies)

| Plugin                   | Detects                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `@typescript-eslint`     | Type errors, unused vars, any usage, consistent imports                      |
| `eslint-plugin-sonarjs`  | Cognitive complexity, duplicate strings, identical functions, collapsible if |
| `eslint-plugin-security` | eval, unsafe regex, non-literal require, object injection, timing attacks    |

### Key rules in `eslint.config.mjs`

```
Code quality:       complexity (15), max-depth (4), max-lines-per-function (80)
Code smells:        sonarjs/cognitive-complexity (15), sonarjs/no-duplicate-string (3)
Security:           no-eval, no-implied-eval, no-new-func (error)
                    security/detect-unsafe-regex, security/detect-eval-with-expression (error)
                    security/detect-object-injection, security/detect-possible-timing-attacks (warn)
```

### VS Code settings (`.vscode/settings.json`)

Must include:

```json
{
  "eslint.validate": ["typescript"],
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }
}
```

## Layer 2: Pre-commit (`.husky/pre-commit`)

The hook runs sequential checks. If any fail, the commit is rejected. See **before-commit-guard** when the user reports a failed commit.

Pre-commit mirrors a **subset** of [`.github/workflows/reusable/quality-static.yml`](../../../.github/workflows/reusable/quality-static.yml). CI additionally runs `deps:audit`, full-repo `pnpm validate`, `validate:domain:coverage`, always-on `db:migrate:lint`, `test:contract`, Semgrep, and full-repo Gitleaks.

| Step | Command                                                                                   | What it catches                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm lint-staged`                                                                        | ESLint + Prettier on staged `src/**/*.ts`, `tooling/setup/**/*.ts`, and `*.{json,yaml,yml,md}`                                                                       |
| 2    | `pnpm typecheck`                                                                          | TypeScript type errors in `src/`                                                                                                                                     |
| 3    | `pnpm validate:domain:strict`                                                             | Domain structure (canonical layout, routes; warnings fail)                                                                                                           |
| 4a   | When `src/domains/**/*.routes.ts` staged: `pnpm routes:catalog` + stage `docs/routes.txt` | Stale route catalog                                                                                                                                                  |
| 4b   | When routes or OpenAPI inputs staged: `pnpm docs:check`                                   | Stale gitignored `docs/openapi/*.json` or `docs/postman-collection.json` vs generator (`tooling/openapi/**`, locale openapi files, codegen scripts)                  |
| 4c   | Always: `pnpm routes:catalog:check`                                                       | Route catalog/registry out of sync                                                                                                                                   |
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
  "src/**/*.ts": ["eslint --fix", "prettier --write"],
  "tooling/setup/**/*.ts": ["eslint --fix", "prettier --write"],
  "*.{json,yaml,yml,md}": ["prettier --write"]
}
```

## Layer 3: CI (`.github/workflows/ci.yml`)

### `quality` job — validate + static security

- **Dependency audit**: `pnpm audit` runs after install; the pipeline **fails on any vulnerability** (no audit-level filter). Keep dependencies and `pnpm.overrides` so that `pnpm audit` passes. See **dependency-security** skill when changing `package.json` or `pnpm-lock.yaml`.
- **Migration safety lint**: `pnpm db:migrate:lint` scans `migrations/*.sql` for zero-downtime-unsafe patterns (same command as pre-commit when SQL migrations are staged).
- **Gitleaks + Semgrep** run in the same job after validate steps (one checkout; no duplicate `security-tests` Vitest job — security tests are in `test:coverage`).

| Step | Tool                          | What it catches                                         |
| ---- | ----------------------------- | ------------------------------------------------------- |
| 1    | `gitleaks/gitleaks-action@v2` | Full-repo secret scan (AWS keys, tokens, passwords)     |
| 2    | `semgrep scan --config auto`  | SAST: SQL injection, XSS, insecure crypto, OWASP Top 10 |

### `test` job (runs after `quality` passes)

- Postgres + Redis service containers → `pnpm db:migrate` → `pnpm test:coverage` (includes security, performance, e2e, integration, unit).

### `api-smoke` job (runs after `quality` passes)

- Postgres + Redis service containers → `pnpm db:migrate` → `pnpm db:seed:full` → background `pnpm tsx src/server.ts` → wait for `/health/ready` → `pnpm test:api-smoke`. Catches route/DI wiring regressions against real HTTP.

### Supporting ignore files

- `.gitleaks.toml` -- paths Gitleaks skips (node_modules, .env.example, lock files, generated docs)
- `.semgrepignore` -- paths Semgrep skips (node_modules, dist, migrations, lock files)

## Convenience scripts (`package.json`)

| Script                  | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `pnpm security:secrets` | Manual full-repo Gitleaks scan (requires `gitleaks` CLI) |
| `pnpm security:sast`    | Manual Semgrep scan (requires `semgrep` CLI)             |
| `pnpm validate`         | lint + format:check + typecheck (same as CI)             |

## Checklist (run after changes)

1. **ESLint config valid?** -- run `pnpm lint` and confirm no config errors
2. **Pre-commit hook executable?** -- `.husky/pre-commit` must have execute permission
3. **lint-staged patterns correct?** -- ensure patterns match actual file locations
4. **CI workflow valid YAML?** -- check `.github/workflows/ci.yml` syntax
5. **Ignore files up to date?** -- `.gitleaks.toml` and `.semgrepignore` include new generated/vendor paths
6. **VS Code settings preserved?** -- ESLint validate + codeActionsOnSave still present
7. **Dependencies installed?** -- `eslint-plugin-sonarjs` and `eslint-plugin-security` in devDependencies

## Adding new rules or plugins

When adding a new ESLint plugin:

1. Install: `pnpm add -D eslint-plugin-<name>`
2. Import in `eslint.config.mjs` and add to `plugins` object
3. Add rules to the `rules` object (use `warn` for code smells, `error` for security)
4. Run `pnpm lint` to verify no false positives on existing code
5. Update this skill's Layer 1 tables above

When adding a new pre-commit check:

1. Add the check to `.husky/pre-commit` (sequential, fail-fast)
2. Update this skill's Layer 2 table above
3. Test with a manual commit
