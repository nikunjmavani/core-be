# Skill triggers (core-be)

When you edit a file matching a pattern below, invoke the listed skill(s).
Single source of truth — consult instead of reading all 26 sync rules.
Skills live in [`agent-os/skills/`](../skills/).

| File pattern | Invoke skill(s) | Notes |
| ------------ | --------------- | ----- |
| `src/domains/**/*.routes.ts` | api-contract-guard → route-schema-doc-guard → route-catalog → seed-maintainer | Also openapi-multilingual if tags changed |
| Route params / public ids / response statuses / request headers | api-contract-guard | Status policy: `docs/reference/api/response-codes.md` |
| `src/domains/**/*.schema.ts` | schema-generator → sql-design-guard → db-migration-maintainer → rls-tenant-isolation-guard | |
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
| `biome.json`, `.husky/pre-commit`, `.husky/pre-push` | code-quality-guard | Pre-push includes the branch-name policy (`agent-os/rules/git-branch-naming.mdc`) |
| `package.json`, `pnpm-lock.yaml` | dependency-security | |
| `src/tests/chaos/**` | chaos-test-maintainer | |
| `src/tests/contract/**` | contract-test-maintainer | |
| `.vscode/extensions.json`, `.vscode/settings.json` | ide-productivity-guard | |
| `tooling/setup/**`, `setup.config.json` | setup-infra-maintainer | |
| `src/shared/locales/*/openapi.json` | openapi-multilingual | |
| `CLAUDE.md`, `AGENTS.md`, `agent-os/rules/**`, `agent-os/skills/**`, `agent-os/agents/**`, `agent-os/mcp/**`, `.mcp.example.json`, `.mcp.default.json` | structure-maintainer | MCP template edits: keep each root template and its `agent-os/mcp/` mirror identical, and keep the `.mcp.default.json` pair identical to its `.mcp.example.json` entries (enforced by the `mcp-config` global test) |
| `tooling/setup/setup.config.json`, `src/shared/constants/project-identity.constants.ts` | project-identity-sync | Rule, **not a skill** — run `pnpm tool:generate-project-identity` (constant map in `project-identity.mdc`) |
| `src/infrastructure/database/contexts/**`, `src/domains/**/*.worker.ts`, RLS migrations | rls-tenant-isolation-guard | |
| `src/shared/middlewares/core/idempotency.middleware.ts`, idempotencyRequired routes, `src/infrastructure/payment/stripe.client.ts` | idempotency-guard | |
| **Finishing any code change** (before declaring it done) | change-completeness-guard | Definition-of-done: own tests + cross-cutting suites + docs + rules + skills all moved with the change. Always-applied rule: `agent-os/rules/change-completeness.mdc` |

> The 26 `agent-os/rules/*-sync.mdc` files remain for Cursor's glob auto-attach.
> This table is the human-readable cross-platform equivalent.
>
> Every entry in the "Invoke skill(s)" column is a skill in `agent-os/skills/` **except** `project-identity-sync` — the one command-driven sync rule (`agent-os/rules/project-identity-sync.mdc`) with no backing skill.
