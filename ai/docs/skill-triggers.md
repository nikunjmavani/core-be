# Skill triggers (core-be)

When you edit a file matching a pattern below, invoke the listed skill(s).
Single source of truth — consult instead of reading all 22 sync rules.
Skills live in [`ai/skills/`](../skills/).

| File pattern | Invoke skill(s) | Notes |
| ------------ | --------------- | ----- |
| `src/domains/**/*.routes.ts` | route-schema-doc-guard → route-catalog → seed-maintainer | Also openapi-multilingual if tags changed |
| `src/domains/**/*.schema.ts` | sql-design-guard → db-migration-maintainer | |
| `src/domains/**/*.container.ts`, `src/routes.ts` | domain-generator (check wiring) | |
| `migrations/*.sql` | db-migration-maintainer | |
| `src/shared/config/env-schema.ts`, `.env.example` | env-schema-add | |
| `src/shared/locales/**/*.json` | i18n-message-guard | |
| `src/domains/**/*.validator.ts`, `*.serializer.ts` | test-generator | |
| `src/domains/**/events/**`, `**/workers/**`, `**/queues/**` | workers-events | |
| `src/domains/**/seed/**`, `src/scripts/seed/**` | seed-maintainer | |
| `src/**/*.ts` (public export added/renamed) | tsdoc-export-guard | |
| `docs/**/*.md` | docs-maintainer | |
| `src/**/OVERVIEW.md` | overview-doc-maintainer | |
| `src/OVERVIEW.md`, `src/PATTERNS.md`, `src/FLOWS.md`, `src/POLICIES.md` | system-narrative-maintainer | |
| `biome.json`, `.husky/pre-commit` | code-quality-guard | |
| `package.json`, `pnpm-lock.yaml` | dependency-security | |
| `src/tests/chaos/**` | chaos-test-maintainer | |
| `src/tests/contract/**` | contract-test-maintainer | |
| `.vscode/extensions.json`, `.vscode/settings.json` | ide-productivity-guard | |
| `tooling/setup/**`, `setup.config.json` | setup-infra-maintainer | |
| `src/shared/locales/*/openapi.json` | openapi-multilingual | |
| `CLAUDE.md`, `AGENTS.md`, `ai/rules/**`, `ai/skills/**`, `ai/agents/**` | structure-maintainer | |
| `tooling/setup/setup.config.json`, `src/shared/constants/project-identity.constants.ts` | project-identity-sync | |

> The 22 `ai/rules/*-sync.mdc` files remain for Cursor's glob auto-attach.
> This table is the human-readable cross-platform equivalent.
