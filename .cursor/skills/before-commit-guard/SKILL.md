---
name: before-commit-guard
description: Ensures code is commit-ready. Invoked when the user runs git commit (enforced by Husky pre-commit) or when the user asks to fix a failed commit. Run the guard checks and fix any failures before committing.
---

# Skill: Before-Commit Guard

## Purpose

Ensure every **git commit** on this repo passes a fixed set of checks. The guard is **enforced** by the Husky pre-commit hook (`.husky/pre-commit`). When the hook fails or the user asks to fix commit/pre-commit errors, use this skill to resolve the failures.

## When to Use

- **Automatic:** The pre-commit hook runs on every `git commit`. If it fails, the commit is rejected.
- **Invoke this skill when:**
  - The user says their commit failed or pre-commit failed
  - The user asks to "fix before commit", "resolve commit errors", or "make code commit-ready"
  - The user edits `.husky/pre-commit` or `package.json` lint-staged config (sync the guard steps with this skill)

## What Runs on Commit (Pre-Commit Hook)

The hook in `.husky/pre-commit` runs these steps in order. If any step fails, the commit is aborted.

| Step | Command / check                                                     | What to do if it fails                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm lint-staged`                                                  | Biome on staged `src/**/*.ts` and `tooling/**/*.{ts,mjs}`; Biome format on `*.{json,yaml,yml}`; `markdownlint-cli2 --fix` on `*.md` (pinned `markdownlint-cli2@0.15.0` matches the GitHub Actions Docs lane). Run `pnpm lint` / `pnpm format` for code; for markdown failures run `pnpm docs:lint:fix` and re-stage. Fix per **code-smells-and-best-practices** (warning details in **lint-warnings-handler**). |
| 2    | `pnpm typecheck`                                                    | TypeScript errors in `src/`. Run `pnpm typecheck`, fix types (no `any`, correct imports).                                                                                                                                                                                                                                                                                                                                     |
| 3    | `pnpm validate:domain:strict`                                       | Domain structure; warnings fail. Fix per **domain-generator** and CLAUDE.md.                                                                                                                                                                                                                                                                                                                                                  |
| 4a   | `pnpm routes:catalog` + `git add docs/routes.txt`                   | Regenerates the checked-in route catalog on every local commit; re-stages generated file so it is included in the commit that will be pushed to GitHub.                                                                                                                                                                                                                                                                       |
| 4b   | When routes **or** OpenAPI inputs staged: `pnpm docs:check`         | OpenAPI inputs: `src/domains/**/*.routes.ts`, `src/shared/locales/*/openapi.json`, `tooling/openapi/**`, `src/scripts/codegen/generate-openapi.ts`, `src/scripts/codegen/openapi-*.ts`, `check-api-docs-sync.ts`. Verifies gitignored `docs/openapi/` and `docs/postman-collection.json`. Run `pnpm docs:all` if drift fails. See **openapi-multilingual**.                                                                   |
| 4c   | Always: `pnpm routes:catalog:check`                                 | Fails if `docs/routes.txt` is out of sync after regeneration.                                                                                                                                                                                                                                                                                                                                                                 |
| 4d   | `pnpm tsdoc:check` | TSDoc coverage gate. Walks `src/**/*.ts`, fails if any public export is missing a TSDoc summary (or `@remarks` for service-like / policy-like files) beyond the locked budget at `tooling/tsdoc-coverage/budget.json`. Resolve by adding TSDoc on the offending exports — see **tsdoc-export-guard**. After fixing, run `pnpm tsdoc:check --refresh-budget` and commit the new lower budget. |
| 5    | `pnpm db:migrate:lint` (**only when** `migrations/*.sql` is staged) | Unsafe SQL patterns (`NOT NULL` without default when adding columns, `RENAME`, destructive drops, FK/CHECK without `NOT VALID`, missing `IF NOT EXISTS`, locking indexes). Fix SQL or add a documented `-- migration-safety: allow <rule_id> reason="..."` header (first 20 lines). See **`db-migration-maintainer`**.                                                                                                        |
| 6    | `pnpm tool:sync-env-example`                                        | `.env.example` vs env schema. Run `pnpm tool:sync-env-example --fix` if needed, add descriptions, re-commit.                                                                                                                                                                                                                                                                                                                  |
| 7    | `gitleaks protect --staged`                                         | Secrets in staged files (skipped if gitleaks not installed locally; CI always scans). Remove secrets; use env vars or `.env.example`. Manual full-repo scan: `pnpm security:secrets`.                                                                                                                                                                                                                                         |
| 8    | Conflict markers                                                    | Reject `<<<<<<<`, `>>>>>>>`, `=======` in staged files. Resolve merge conflicts.                                                                                                                                                                                                                                                                                                                                              |
| 9    | Large files                                                         | Reject staged added/copied/modified/renamed files > 1MB. Unstage or add to `.gitignore`; use LFS if needed.                                                                                                                                                                                                                                                                                                                   |

## Pre-push hook (`.husky/pre-push`)

Runs before `git push` (fast compile gate; full suite is CI):

| Step | Command            | What to do if it fails                          |
| ---- | ------------------ | ----------------------------------------------- |
| 1    | `pnpm typecheck`   | Fix TypeScript errors in `src/`.                |
| 2    | `pnpm build`       | Fix compile errors (`tsc` + `tsc-alias`).       |
| 3    | `pnpm build:check` | Fix unresolved `@/` path aliases in `dist/`.    |
| 4    | `pnpm test:unit`   | Fix failing unit tests under `src/tests/unit/`. |

Full PR gate: `pnpm ci:local` or wait for CI (`quality` + `test` + `api-smoke` + …).

## Commit message hook (after pre-commit)

`.husky/commit-msg` runs **`pnpm exec commitlint --edit "$1"`** against [commitlint.config.cjs](../../../commitlint.config.cjs). If your commit is rejected, rewrite the subject line to [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: …`, `fix: …`, `chore: …`).

## Commands to Run Locally (Same as the Guard)

Before committing, the user (or AI) can run:

```bash
pnpm validate                  # biome check + typecheck
pnpm validate:domain:strict    # domain structure (warnings fail; same as hook step 3)
pnpm routes:catalog:check      # docs/routes.txt in sync
pnpm docs:check                # OpenAPI specs in sync (when routes or openapi inputs change)
pnpm docs:lint                 # markdownlint (same config + cli2 version as the Docs lane)
pnpm docs:lint:fix             # auto-fix the markdown nits markdownlint can repair
pnpm db:migrate:lint           # when editing migrations/*.sql (CI always runs full migrations/)
pnpm tool:sync-env-example     # .env.example vs env schema
pnpm deps:audit                # optional; CI runs this (may have known moderate in dev deps)
```

If all pass, the pre-commit hook should pass. If `deps:audit` fails, see **dependency-security** (overrides, upgrades).

## What Was Done Previously (Reference)

These one-time or ongoing practices are part of keeping the repo commit-clean:

1. **Format + lint** — Biome on `src/` and `tooling/`; `pnpm format` / `pnpm lint` to fix; `pnpm validate` runs `biome check` + typecheck.
2. **Lint warnings** — Resolve per **code-smells-and-best-practices** / **lint-warnings-handler**.
3. **Typecheck** — `tsc --noEmit`; fix all type errors.
4. **Domain structure** — `pnpm validate:domain`; domains and sub-domains must match CLAUDE.md layout.
5. **Dependency audit** — `pnpm audit`; use `pnpm.overrides` for transitive vulns when safe; see **dependency-security**.
6. **Runtime/test warnings (resolved in code):**
   - **i18next** — `showSupportNotice: false` in `src/shared/middlewares/i18n.middleware.ts` so the Locize notice is not logged.
   - **BullMQ Redis eviction** — In `src/tests/setup.ts`, `console.warn` is filtered for the "Eviction policy is volatile-lru" message so test output is clean; production Redis should use `noeviction` where possible.

## How to Fix When the Hook Fails

1. **Read the hook output** — It will show which step failed (lint-staged, typecheck, validate:domain:strict, route-catalog, docs:check, **migration SQL lint**, env-example sync, gitleaks, conflict markers, or large files).
2. **Run the failing command** — e.g. `pnpm validate` or `pnpm validate:domain` or `gitleaks protect --staged`.
3. **Apply the right skill** — Use **code-smells-and-best-practices**, **route-catalog**, **env-schema-add**, **dependency-security**, or **domain-generator** as needed.
4. **Re-stage and commit** — After fixes, `git add` and `git commit` again.

## Dependencies

- **code-quality-guard** — Defines the 3-layer pipeline; pre-commit is Layer 2. When changing `.husky/pre-commit` or lint-staged, keep both skills in sync.
- **code-smells-and-best-practices** — Fix lint/type issues when the hook fails.
- **dependency-security** — For `pnpm audit` failures and overrides.

## Maintaining This Skill

- If new pre-commit steps are added to `.husky/pre-commit`, update the "What Runs on Commit" table and the fix instructions.
- If the project adds new guard checks (e.g. env-example sync), add them to the hook and document them here.
