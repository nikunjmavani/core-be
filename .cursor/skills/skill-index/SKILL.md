---
name: skill-index
description: Master index of all project skills with trigger conditions. Use this skill FIRST to determine which other skill(s) to invoke based on what changed. Consult after any code change to check if a skill should run.
---

# Skill Index (core-be)

Master directory of all **32 project skills**. **Consult this skill first** to determine which skill(s) to invoke based on what you just changed or are about to change.

For **Cursor-built-in** skills (`~/.cursor/skills-cursor/`), see **cursor-global-skills**.

## Project skills (32)

| Skill                          | Path                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| skill-index                    | `.cursor/skills/skill-index/SKILL.md`                                     |
| test-generator                 | `.cursor/skills/test-generator/SKILL.md`                                  |
| route-catalog                  | `.cursor/skills/route-catalog/SKILL.md`                                   |
| openapi-route-sync             | `.cursor/skills/openapi-route-sync/SKILL.md`                              |
| seed-maintainer                | `.cursor/skills/seed-maintainer/SKILL.md`                                 |
| domain-generator               | `.cursor/skills/domain-generator/SKILL.md`                                |
| schema-generator               | `.cursor/skills/schema-generator/SKILL.md`                                |
| sql-design-guard               | `.cursor/skills/sql-design-guard/SKILL.md`                                |
| db-migration-maintainer        | `.cursor/skills/db-migration-maintainer/SKILL.md`                         |
| workers-events                 | `.cursor/skills/workers-events/SKILL.md`                                  |
| supabase-porting               | `.cursor/skills/supabase-porting/SKILL.md`                                |
| code-quality-guard             | `.cursor/skills/code-quality-guard/SKILL.md`                              |
| code-smells-and-best-practices | `.cursor/skills/code-smells-and-best-practices/SKILL.md`                  |
| lint-warnings-handler          | `.cursor/skills/lint-warnings-handler/SKILL.md` (detail; via code-smells) |
| before-commit-guard            | `.cursor/skills/before-commit-guard/SKILL.md`                             |
| dependency-security            | `.cursor/skills/dependency-security/SKILL.md`                             |
| structure-maintainer           | `.cursor/skills/structure-maintainer/SKILL.md`                            |
| production-hardening-guard     | `.cursor/skills/production-hardening-guard/SKILL.md`                      |
| path-to-production-gate        | `.cursor/skills/path-to-production-gate/SKILL.md`                         |
| i18n-message-guard             | `.cursor/skills/i18n-message-guard/SKILL.md`                              |
| openapi-multilingual           | `.cursor/skills/openapi-multilingual/SKILL.md`                            |
| env-schema-add                 | `.cursor/skills/env-schema-add/SKILL.md`                                  |
| ide-productivity-guard         | `.cursor/skills/ide-productivity-guard/SKILL.md`                          |
| docs-maintainer                | `.cursor/skills/docs-maintainer/SKILL.md`                                 |
| docs-audit                     | `.cursor/skills/docs-audit/SKILL.md`                                      |
| setup-infra-maintainer         | `.cursor/skills/setup-infra-maintainer/SKILL.md`                          |
| pr-babysit                     | `.cursor/skills/pr-babysit/SKILL.md`                                      |
| split-to-prs                   | `.cursor/skills/split-to-prs/SKILL.md`                                    |
| ci-investigator                | `.cursor/skills/ci-investigator/SKILL.md`                                 |
| contract-test-maintainer       | `.cursor/skills/contract-test-maintainer/SKILL.md`                        |
| chaos-test-maintainer          | `.cursor/skills/chaos-test-maintainer/SKILL.md`                           |
| cursor-global-skills           | `.cursor/skills/cursor-global-skills/SKILL.md` (reference only)           |

## Skill trigger map

| What changed                                                                                                                                                                                                    | Skill to invoke                                                                                            | Path                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Added/removed/updated a route in `*.routes.ts`                                                                                                                                                                  | **route-catalog** + **openapi-route-sync** + **seed-maintainer**                                           | route-catalog, openapi-route-sync, seed-maintainer                |
| Created a new domain or sub-domain                                                                                                                                                                              | **domain-generator**                                                                                       | `.cursor/skills/domain-generator/SKILL.md`                        |
| Added event emission, queue, or worker                                                                                                                                                                          | **workers-events**                                                                                         | `.cursor/skills/workers-events/SKILL.md`                          |
| Changed ESLint rules, pre-commit hooks, or CI security                                                                                                                                                          | **code-quality-guard**                                                                                     | `.cursor/skills/code-quality-guard/SKILL.md`                      |
| Changed `package.json`, `pnpm-lock.yaml`, or dependency versions                                                                                                                                                | **dependency-security**                                                                                    | `.cursor/skills/dependency-security/SKILL.md`                     |
| Renamed/moved files, folders, or layers                                                                                                                                                                         | **structure-maintainer**                                                                                   | `.cursor/skills/structure-maintainer/SKILL.md`                    |
| Porting code from Supabase Edge Functions                                                                                                                                                                       | **supabase-porting**                                                                                       | `.cursor/skills/supabase-porting/SKILL.md`                        |
| Added/changed `migrations/*.sql` or schema needs SQL migration                                                                                                                                                  | **db-migration-maintainer**                                                                                | `.cursor/skills/db-migration-maintainer/SKILL.md`                 |
| New/updated feature: routes, validators, serializers, utils, services, workers, or tests                                                                                                                        | **test-generator**                                                                                         | `.cursor/skills/test-generator/SKILL.md` — unit vs domain pyramid |
| Added/modified domain tests or test factories only                                                                                                                                                              | **test-generator**                                                                                         | `.cursor/skills/test-generator/SKILL.md`                          |
| Moved or added domain/sub-domain tests (`sub-domains/*/ __tests__/unit`, `events/__tests__`, `tenancy/__tests__/factories/`)                                                                                    | **test-generator** (+ **structure-maintainer** if `CLAUDE.md` layout paths change)                         | test-generator, structure-maintainer                              |
| Changed where tests live (test layout: Vitest under `src/`, root `tests/` only for k6)                                                                                                                          | **structure-maintainer**                                                                                   | `.cursor/skills/structure-maintainer/SKILL.md`                    |
| Added/modified Drizzle schema files                                                                                                                                                                             | **schema-generator** + **sql-design-guard** + **db-migration-maintainer**                                  | schema-generator, sql-design-guard, db-migration-maintainer       |
| Changed seed scripts or added new seeded data                                                                                                                                                                   | **seed-maintainer**                                                                                        | `.cursor/skills/seed-maintainer/SKILL.md`                         |
| Modified middleware, infra, or security config                                                                                                                                                                  | **production-hardening-guard**                                                                             | `.cursor/skills/production-hardening-guard/SKILL.md`              |
| **Before path-to-production action** (release, deploy, ready-for-production)                                                                                                                                    | **path-to-production-gate**                                                                                | `.cursor/skills/path-to-production-gate/SKILL.md`                 |
| **Git commit** (pre-commit hook runs guard) or user asks to fix failed commit                                                                                                                                   | **before-commit-guard**                                                                                    | `.cursor/skills/before-commit-guard/SKILL.md`                     |
| Adding or editing code under `src/` (quality, lint warnings, best practices)                                                                                                                                    | **code-smells-and-best-practices** (uses **lint-warnings-handler** for warning details)                    | `.cursor/skills/code-smells-and-best-practices/SKILL.md`          |
| Changed k6 scenarios, load-test scripts, or load-test docs                                                                                                                                                      | **structure-maintainer** (keep `docs/reference/testing/load-testing.md` and `src/tests/load/k6/README.md` in sync) | `.cursor/skills/structure-maintainer/SKILL.md`                    |
| Added/edited user-facing message or translation key in errors, validators, services, controllers, constants, or locales                                                                                         | **i18n-message-guard**                                                                                     | `.cursor/skills/i18n-message-guard/SKILL.md`                      |
| Added/changed OpenAPI locale files or multilingual OpenAPI (src/shared/locales/\*/openapi.json, docs:generate:multilang)                                                                                        | **openapi-multilingual**                                                                                   | `.cursor/skills/openapi-multilingual/SKILL.md`                    |
| Changed env schema (`src/shared/config/env-schema.ts`) or `.env.example`                                                                                                                                                          | **env-schema-add**                                                                                         | `.cursor/skills/env-schema-add/SKILL.md`                          |
| Changed `.vscode/extensions.json` or `.vscode/settings.json`                                                                                                                                                    | **ide-productivity-guard**                                                                                 | `.cursor/skills/ide-productivity-guard/SKILL.md`                  |
| Added/renamed/moved a doc under `docs/` (hand-written .md); changed `docs/deployment/ci-cd/branch-protection.md` or `.github/rulesets/*.json`; or changed CI job `name:` fields referenced in branch protection | **docs-maintainer**                                                                                        | `.cursor/skills/docs-maintainer/SKILL.md`                         |
| User asks to "review docs" or "audit documentation"                                                                                                                                                             | **docs-audit**                                                                                             | `.cursor/skills/docs-audit/SKILL.md`                              |
| Added/removed/changed a third-party provider in setup:infra (`tooling/setup/`)                                                                                                                                  | **setup-infra-maintainer**                                                                                 | `.cursor/skills/setup-infra-maintainer/SKILL.md`                  |
| User asks to babysit a PR, fix PR CI, or get branch merge-ready                                                                                                                                                 | **pr-babysit**                                                                                             | `.cursor/skills/pr-babysit/SKILL.md`                              |
| User asks why a specific CI check failed                                                                                                                                                                        | **ci-investigator**                                                                                        | `.cursor/skills/ci-investigator/SKILL.md`                         |
| User asks to split work into multiple PRs                                                                                                                                                                       | **split-to-prs**                                                                                           | `.cursor/skills/split-to-prs/SKILL.md`                            |
| Changed contract tests or Stripe/Resend/S3 client wrappers                                                                                                                                                      | **contract-test-maintainer**                                                                               | `.cursor/skills/contract-test-maintainer/SKILL.md`                |
| Changed chaos tests, Toxiproxy provision, or chaos Docker profile                                                                                                                                               | **chaos-test-maintainer**                                                                                  | `.cursor/skills/chaos-test-maintainer/SKILL.md`                   |
| Added/changed `migrations/*.sql` only (no schema file in same change)                                                                                                                                           | **db-migration-maintainer**                                                                                | `.cursor/skills/db-migration-maintainer/SKILL.md`                 |
| Changed domain `*.seed.ts` or `src/scripts/seed/**`                                                                                                                                                             | **seed-maintainer**                                                                                        | `.cursor/skills/seed-maintainer/SKILL.md`                         |

## Trigger detection rules

After completing any task, scan the changes and invoke matching skills:

### Route changes

- **Trigger**: any `*.routes.ts` file was created, modified, or deleted
- **Action**: `route-catalog` → `openapi-route-sync` → `seed-maintainer` → **test-generator** (e2e for new routes).

### Domain/sub-domain scaffolding

- **Trigger**: new folder under `src/domains/`, new `*.container.ts`, new route registration in `src/routes.ts`
- **Action**: read `domain-generator` for canonical layout and naming rules
- **Follow-up**: also invoke `route-catalog` (new routes) and `structure-maintainer` (new paths)

### Events, queues, workers

- **Trigger**: new `events/`, `queues/`, or `workers/` directory; new event type; new BullMQ queue or processor; changes to `src/infrastructure/queue/bootstrap.ts`
- **Action**: read and follow `workers-events` for patterns and wiring

### Code quality and security pipeline

- **Trigger**: changes to `eslint.config.mjs`, `.husky/pre-commit`, `lint-staged` in `package.json`, `.github/workflows/ci.yml`, `.gitleaks.toml`, `.semgrepignore`
- **Action**: read and follow `code-quality-guard` checklist

### Dependency security

- **Trigger**: changes to `package.json` (dependencies, devDependencies, pnpm.overrides) or `pnpm-lock.yaml`
- **Action**: read and follow `dependency-security` — keep zero vulnerabilities, prefer safe updates, run audit + validate + test

### Code quality when implementing (`src/`)

- **Trigger**: any add or modify of code under `src/`
- **Action**: read and follow `code-smells-and-best-practices` — fix ESLint issues in touched files; use `lint-warnings-handler` for per-warning guidance. Full `pnpm lint` / `pnpm typecheck` run on pre-commit and CI — do not duplicate unless the hook failed or you are finishing a large change

### Structure and naming

- **Trigger**: renamed or moved files/folders, new layers, changed directory conventions
- **Action**: read and follow `structure-maintainer` to update CLAUDE.md, README.md, rules, and other skills

### Tests (new or updated feature)

- **Trigger**: added or changed `*.validator.ts`, `*.serializer.ts`, `shared/utils/**`, `*.routes.ts`, domain `__tests__/**`, `src/tests/unit/**`, `src/tests/chaos/**`, workers under `**/workers/**`, or user asks to add/update tests
- **Action**: read and follow **test-generator** — apply the testing pyramid (unit for pure layers, domain e2e for routes/DB); run the checklist and targeted `pnpm test:*` commands before done

### Supabase porting

- **Trigger**: porting logic from `supabase/functions/` into `src/`
- **Action**: read **supabase-porting** (manual invoke only)

### SQL migrations

- **Trigger**: new/changed `*.schema.ts` or `migrations/*.sql`
- **Action**: **db-migration-maintainer** after **sql-design-guard**; run **`pnpm db:migrate:lint`** then `pnpm db:migrate`

### i18n message guard

- **Trigger**: added or edited user-facing message or translation key in `src/shared/errors/**`, `src/shared/middlewares/error-handler.middleware.ts`, `src/domains/**/*.validator.ts`, `src/domains/**/*.service.ts`, `src/domains/**/*.controller.ts`, `src/shared/constants/**`, or `src/shared/locales/**`
- **Action**: read and follow `i18n-message-guard` — use translation keys in code, add/update keys in `src/shared/locales/en/` (and other locales), no raw user-facing strings in errors or success payloads

### Path to production gate

- **Trigger**: user requests "path to production", "pre-production review", "ready for production", or similar; or references `docs/deployment/runbooks/runbook-dev-to-production.md`
- **Action**: read and follow `path-to-production-gate` — run full production-hardening and extra checks, produce a plan, ask the user to review the plan, and do not proceed with production actions until the user confirms

### Before commit guard

- **Trigger**: user runs `git commit` and the pre-commit hook fails; or user asks to fix commit errors, pre-commit failures, or make code commit-ready; or user edits `.husky/pre-commit` or `package.json` lint-staged
- **Action**: read and follow `before-commit-guard` — run `pnpm validate`, `pnpm validate:domain`, fix the failing step (lint, typecheck, domain structure, gitleaks, conflicts, large files) per the skill

### OpenAPI multilingual

- **Trigger**: added or changed `src/shared/locales/*/openapi.json`; added a new locale for OpenAPI; or changed OpenAPI generation to use new locale keys
- **Action**: read and follow `openapi-multilingual` — keep all locale files in sync (same keys), run `pnpm docs:generate:multilang` after changes

### Env schema add

- **Trigger**: added, renamed, or removed env vars in `src/shared/config/env-schema.ts`, or edited `.env.example`; or changed `.github/sync.config.json` (new hosted environment)
- **Action**: read and follow `env-schema-add` — for new keys, place under the correct `# GitHub Secrets` / `# GitHub Variables` half in `.env.example` (section IS classification), run `pnpm tool:sync-env-example`, run `pnpm github:sync <env> --dry-run` for each hosted environment. For a new hosted environment: add `NODE_ENV` enum value, edit `.github/sync.config.json`, update `deploy-railway.yml`, then `pnpm github:sync --check` and `pnpm github:sync`. Paste the PR description snippet from `tool:sync-env-example`.

### IDE productivity guard

- **Trigger**: edited `.vscode/extensions.json` or `.vscode/settings.json`; or user asks for IDE/productivity recommendations; or you add or change project tooling (e.g. new test framework, linter, ORM) that has a well-known VS Code extension
- **Action**: read and follow `ide-productivity-guard` — keep extensions backend-only, settings aligned with curated list, cSpell.words merged; when adding new tooling, consider adding the relevant extension to `.vscode/extensions.json`

### Docs maintainer

- **Trigger**: added, renamed, or moved a hand-written doc under `docs/` (e.g. new .md file, reorganized into subfolders); changed `docs/deployment/ci-cd/branch-protection.md` or `.github/rulesets/*.json`; changed CI job `name:` fields referenced by branch protection; or changed links that point to docs
- **Action**: read and follow `docs-maintainer` — update `docs/README.md` index, fix all cross-references (README, CLAUDE, skills, rules, .env.example, src/tests/load/k6/README.md, workflows), use subfolder + lowercase kebab-case for new docs

### Docs audit

- **Trigger**: user asks to "review docs", "audit documentation", or similar; or after large docs reorganization
- **Action**: read and follow `docs-audit` — full pass: index, naming, Mermaid in flow docs, cross-links

### SQL design (Drizzle schemas)

- **Trigger**: any `*.schema.ts` file under `src/domains/` was created or modified — new tables, new columns, changed indexes or constraints
- **Action**: read and follow `sql-design-guard` — run the full checklist: table naming, column naming, data types, auto-index suggestions, partitioning recommendations, constraint naming, audit/soft-delete patterns, and SQL formatting. Output the SQL Design Guard Review block at the end.
- **Note**: this runs alongside `schema-generator` (which handles scaffolding); `sql-design-guard` reviews and enhances the design quality.

### Setup infra (third-party providers)

- **Trigger**: added, removed, or changed a third-party provider in the setup:infra flow (e.g. new provider in `tooling/setup/config.ts`, new `tooling/setup/providers/*.provider.ts`, or changes to PREVIEW_PROVIDERS, guide steps, or token instructions)
- **Action**: read and follow `setup-infra-maintainer` — run the full checklist so config schema, init defaults, secrets/env-secrets, orchestrator (preview, provision, check, status, rollback), guide, prerequisites, provider module, state, build-env-vars, and `docs/deployment/setup/setup-token-instructions.md` all stay in sync. Then run `pnpm typecheck` and `pnpm setup:infra:preview` to verify.
- **Follow-up**: if `docs/deployment/setup/setup-token-instructions.md` or other deployment docs were updated, invoke **docs-maintainer** to keep the docs index and cross-links correct.

## Multi-skill scenarios

Some changes trigger multiple skills. Run them in this order:

1. **domain-generator** (scaffold first)
2. **schema-generator** + **sql-design-guard** (if new tables)
3. **db-migration-maintainer** (SQL in `migrations/`)
4. **workers-events** (wire events/queues if needed)
5. **route-catalog** + **openapi-route-sync** (routes + OpenAPI metadata)
6. **seed-maintainer** (when routes/APIs changed)
7. **test-generator** (unit + domain e2e per pyramid)
8. **code-quality-guard** (if lint/CI config changed)
9. **structure-maintainer** (sync docs and rules last)
10. **docs-maintainer** (when docs added/renamed/moved)

## Always-applied rules

| Rule file                    | Scope                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engineering-principles.mdc` | Every session — general engineering behavior (simplicity, quality, security, output style). Does not invoke a skill; complements CLAUDE.md and file-scoped rules below. |

## Enforcement layers (no duplicate work)

| Layer          | What runs                                                                                                                                                    | Role                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Agent**      | Skills from this index + file-scoped `.mdc` rules                                                                                                            | Implement + fix touched files; generate artifacts once (`pnpm routes:catalog`, env sync) |
| **Pre-commit** | `lint-staged`, `typecheck`, `validate:domain`, `routes:catalog:check`, `db:migrate:lint` (when `migrations/*.sql` staged), `tool:sync-env-example`, gitleaks | Local gate (mirrors CI sync checks)                                                      |
| **CI**         | `pnpm ci:quality` (or individual: validate, validate:domain, routes:catalog:check, db:migrate:lint, tool:sync-env-example, deps:audit)                       | Verifies repo on PR                                                                      |

Do not run the same command in agent and again manually unless fixing a failed hook/CI step.

## Auto-trigger rules

The following `.cursor/rules/*.mdc` files auto-invoke skills based on file globs:

| Rule file                                 | Triggers on                                                                                                                                                                         | Invokes skill                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `domain-generator-sync.mdc`               | `src/domains/**/*.container.ts`, `*.routes.ts`, `src/routes.ts`                                                                                                                     | domain-generator + route-catalog + openapi-route-sync (when `*.routes.ts`) |
| `testing-conventions.mdc`                 | `src/domains/**/__tests__/**`, `src/tests/**`, validators, serializers                                                                                                              | test-generator                                                             |
| `production-hardening.mdc`                | `src/infrastructure/**`, `src/shared/middlewares/**`, `src/shared/config/**`                                                                                                         | production-hardening-guard                                                 |
| `workers-events-sync.mdc`                 | `src/domains/**/events/**`, `**/queues/**`, `**/workers/**`, `src/infrastructure/queue/**`, `src/core/events/**`                                                                    | workers-events                                                             |
| `code-quality-guard-sync.mdc`             | `eslint.config.mjs`, `.husky/pre-commit`, `.github/workflows/**`, `.gitleaks.toml`, `.semgrepignore`                                                                                | code-quality-guard                                                         |
| `dependency-security-sync.mdc`            | `package.json`, `pnpm-lock.yaml`                                                                                                                                                    | dependency-security                                                        |
| `structure-maintainer-sync.mdc`           | `CLAUDE.md`, `README.md`, `.cursor/rules/**/*.mdc`, `.cursor/skills/**/SKILL.md`                                                                                                    | structure-maintainer                                                       |
| `code-smells-and-best-practices-sync.mdc` | `src/**/*.ts`                                                                                                                                                                       | code-smells-and-best-practices (single quality owner)                      |
| `i18n-message-guard-sync.mdc`             | `src/shared/errors/**`, `error-handler.middleware.ts`, `src/domains/**/*.validator.ts`, `**/*.service.ts`, `**/*.controller.ts`, `src/shared/constants/**`, `src/shared/locales/**` | i18n-message-guard                                                         |
| `new-requirement-intake.mdc`              | `docs/getting-started/requirement-intake.md`                                                                                                                                        | skill-index + intake doc (run skills per requirement type)                 |
| `path-to-production-gate.mdc`             | `docs/deployment/runbooks/runbook-dev-to-production.md`                                                                                                                             | path-to-production-gate (full review, plan, user review before production) |
| `before-commit-guard-sync.mdc`            | `.husky/pre-commit`, `package.json`; or user reports failed commit / fix pre-commit                                                                                                 | before-commit-guard (guard runs on git commit; fix failing steps)          |
| `env-schema-add-sync.mdc`                 | `src/shared/config/env-schema.ts`, `.env.example`                                                                                                                                                   | env-schema-add                                                             |
| `ide-productivity-guard-sync.mdc`         | `.vscode/extensions.json`, `.vscode/settings.json`                                                                                                                                  | ide-productivity-guard                                                     |
| `docs-maintainer-sync.mdc`                | `docs/**/*.md` (hand-written; excludes generated openapi/postman/routes)                                                                                                            | docs-maintainer                                                            |
| `sql-design-guard-sync.mdc`               | `src/domains/**/*.schema.ts`                                                                                                                                                        | sql-design-guard                                                           |
| `db-migration-maintainer-sync.mdc`        | `migrations/*.sql`, `src/domains/**/*.schema.ts`                                                                                                                                    | db-migration-maintainer (+ sql-design-guard for schemas)                   |
| `seed-maintainer-sync.mdc`                | `src/domains/**/*.seed.ts`, `src/scripts/seed/**/*.ts`                                                                                                                              | seed-maintainer                                                            |
| `openapi-multilingual-sync.mdc`           | `src/shared/locales/*/openapi.json`, OpenAPI generator scripts                                                                                                                      | openapi-multilingual                                                       |
| `contract-test-maintainer-sync.mdc`       | `src/tests/contract/**`, payment/mail/storage infra, `tooling/vitest/contract.config.ts`                                                                                            | contract-test-maintainer                                                   |
| `chaos-test-maintainer-sync.mdc`          | `src/tests/chaos/**`, `tooling/vitest/chaos.config.ts`, chaos provision, `docker-compose.yml`                                                                                       | chaos-test-maintainer                                                      |
| `setup-infra-maintainer-sync.mdc`         | `tooling/setup/**/*.ts`, `tooling/setup.config.json`, `docs/deployment/setup/setup-token-instructions.md`                                                                           | setup-infra-maintainer                                                     |

**supabase-porting** = manual only (Supabase Edge Functions → core-be).

**pr-babysit**, **split-to-prs**, **ci-investigator**, **docs-audit** = user-requested (no file glob rule).

**cursor-global-skills** = reference only (Cursor built-in skills; not for domain work).

## New requirement workflow

When the user gives a **new requirement**, read **`docs/getting-started/requirement-intake.md`**, identify the requirement type, then run the **Skills to run** in order for that type. The rule **new-requirement-intake.mdc** triggers when the intake doc is referenced.

## Maintaining this index

When a **new skill is created**, add it to:

1. The trigger map table above
2. The trigger detection rules section
3. The multi-skill scenarios order (if applicable)
4. The auto-trigger rules section (if it has a `.mdc` auto-invoke rule)
5. `CLAUDE.md` under "Keeping Docs and Skills in Sync"
