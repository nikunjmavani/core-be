---
name: structure-maintainer
description: Keeps core-be project structure standards up to date. Use after any directory/file naming changes, new layers, or moving code across domains/infrastructure/shared/tooling/tests.
---

# Structure maintainer (core-be)

## Purpose

This skill ensures that when the **project structure changes**, the repo's "source of truth" docs and Cursor rules/skills are updated **in the same PR** so the conventions don't drift.

## After updating code structure: update these

Whenever you change code structure (e.g. add a domain, rename layers, add infrastructure), you **must** update the following so rules and skills stay in sync:

- **Rules:** `.cursor/rules/core-be-src-architecture.mdc` — ensure it matches current layout and naming.
- **Skills:**
  - `.cursor/skills/domain-generator/SKILL.md` (scaffolding and sub-domain list)
  - `.cursor/skills/workers-events/SKILL.md` (if events/queues/workers paths changed)
  - `.cursor/skills/supabase-porting/SKILL.md` (if Supabase porting conventions changed)
  - `.cursor/skills/db-migration-maintainer/SKILL.md` (if SQL migration conventions changed)
  - `.cursor/skills/test-generator/SKILL.md` (if test layout or scripts changed)
  - `.cursor/skills/overview-doc-maintainer/SKILL.md` (if a new folder role appears that needs a new `OVERVIEW.md` template)
  - `.cursor/skills/tsdoc-export-guard/SKILL.md` (if the TSDoc coverage gate inputs changed)
  - Any other `.cursor/skills/*/SKILL.md` that references paths or layer names
- **Docs:** `CLAUDE.md` (architecture and domain layout), `README.md` (project structure and diagrams), `AGENTS.md` (agent entry + custom subagents).
- **Agents:** `.cursor/agents/*.md` — keep in sync with **AGENTS.md** custom subagents table when adding or renaming subagents.
- **System narratives**: when a new domain folder appears under `src/domains/`, also invoke **system-narrative-maintainer** to add the row to `src/OVERVIEW.md` Domains table.

Then run the **Checklist** below and verify with `pnpm typecheck` (and tests if applicable).

## Current source-of-truth conventions

### Canonical domain layout (required)

Domain folder = DB schema. Multi-resource domains use `sub-domains/` for API resources. **Sub-domains may contain nested sub-domains** (aggregate children). Flat domains (`audit`, `upload`) keep layers at domain root.

```text
src/domains/<domain>/
  <domain>.routes.ts
  <domain>.container.ts
  events/                     # optional: register<Domain>EventHandlers() aggregator
  __tests__/                  # domain e2e, unit, factories (see Test layout)
  sub-domains/                # required except audit, upload
    <sub-domain>/             # top-level resource
      ... layers ...
      __tests__/unit/         # optional
      events/ | queues/ | workers/   # optional
      <nested-sub-domain>/    # optional aggregate child (webhook-event, organization-api-key, …)
        ... layers ...
        __tests__/unit/
```

Import: `@/domains/<domain>/sub-domains/<sub-domain>/...` or `@/domains/<domain>/sub-domains/<parent>/<nested>/...`.

### Import path conventions

| Tree | Allowed | Forbidden |
| ---- | ------- | --------- |
| `src/**/*.ts` | `@/domains/...`, `@/shared/...`, `@/infrastructure/...`, `@/core/...`; same-folder `./` | Parent-relative `../` |
| `tooling/**/*.ts` | `@tooling/setup/...`, `@tooling/openapi/...`, etc.; same-folder `./` | Parent-relative `../` |

Enforced by `src/tests/global/import-paths.global.test.ts`. Rule: `.cursor/rules/import-paths.mdc`.

### Infrastructure layout

```text
src/infrastructure/
  database/
    connection.ts             # Postgres + Drizzle
    base-repository.ts        # Pagination helper
    transaction.ts            # withTransaction()
    migrate.ts                # Migration runner
    pg-schemas.ts             # Shared pgSchema definitions
    pool/                     # Pool tuning helpers
    safety/                   # Statement timeout, RLS helpers
    utils/                    # Shared DB utilities
  cache/
    redis.client.ts           # Redis connection
  queue/
    connection.ts             # Queue Redis re-export + getBullMQConnectionOptions
    worker-options.ts         # Stalls, lock duration (shared worker tuning)
    dead-letter.ts            # Dead-letter helper queues (`<source>:dlq`) + final-retry alerting
    scheduler.ts              # Repeatable retention job registration
    bootstrap.ts              # Domain worker registration + DLQ hooks
    queue-dashboard.ts        # Optional Bull Board
  mail/
    mail.service.ts
  storage/
    storage.service.ts
```

### Shared layout

```text
src/shared/
  config/env.config.ts
  errors/{app,validation,auth}.error.ts, index.ts
  types/index.ts
  constants/index.ts
  utils/                      # grouped by concern (http/, security/, infrastructure/, …)
  middlewares/
    core/                     # auth, error-handler, health, request-context, …
    security/                 # cors, helmet, captcha, …
    session/                  # cookie session helpers
    tenant/                   # X-Organization-Id + RLS transaction
    rate-limit/               # global + route presets
    index.ts                  # registerMiddleware()
```

### Repo root tooling (`tooling/`)

Outside `src/` — not part of the runtime app. Do not merge with `src/scripts/` (those may import `@/`).

```text
tooling/
  setup-infra/        # External infra wizard (pnpm setup:infra*) — Neon, Railway, Stripe, GitHub secrets
                      # Providers live under setup-infra/providers/setup-<name>/setup-<name>.provider.ts
  setup-infra/setup.config.json   # Wizard config (committed)
  ci/                 # Build/CI guards (check-dockerfile-sync.mjs, check-dist-imports.mjs)
  dev/                # Local dev helpers (wait-for-local-postgres.sh → pnpm compose:wait)
```

### Build-time scripts

```text
src/scripts/    # e.g. generate-openapi.ts → docs/openapi/openapi.json for ApiDog
```

### Test layout

- **Vitest** (all under `src/`):
  - **Common**: `src/tests/` — helpers, shared factories, security, performance, global, chaos, contract.
  - **Domain bundled e2e**: `src/domains/<domain>/__tests__/<domain>.test.ts`.
  - **Domain unit / policy**: `src/domains/<domain>/__tests__/unit/`.
  - **Domain factories**: `src/domains/<domain>/__tests__/factories/` (e.g. tenancy `permission.factory.ts`).
  - **Sub-domain unit**: `sub-domains/<r>/__tests__/unit/` or `sub-domains/<parent>/<child>/__tests__/unit/`.
  - **Sub-domain e2e** (optional): `sub-domains/<parent>/<child>/__tests__/<child>.test.ts`.
  - **Event handlers / emit**: `sub-domains/<r>/__tests__/unit/events/` (never `events/__tests__/`)
- **Commands**: `pnpm test:unit` (unit + `__tests__/unit/events/`); `pnpm test:e2e` (excludes `__tests__/unit/`); `pnpm test` runs all.
- **k6 load**: `src/tests/load/k6/` (not Vitest).
- **Detail**: `.cursor/skills/test-generator/SKILL.md`, `.cursor/rules/testing-conventions.mdc`.

### Naming rules

- **Full names only**: `repository` not `repo`, `organization` not `org`, `database` not `db`, `request` not `req` (except Fastify conventions).
- **Sub-domain directories**: always domain-prefixed (`user-settings`, `organization-settings`, `member-role-permission`, `webhook-event`).
- **Drizzle schema**: snake_case column property names matching Postgres.

## Mandatory update targets when structure changes

When any of the above conventions change, update these files so they remain accurate:

- `.cursor/skills/skill-index/SKILL.md` (master skill trigger map and enforcement layers — update when adding skills or changing pre-commit/CI checks)
- `CLAUDE.md` (human-facing architecture rules)
- `README.md` (high-level structure overview + Architecture Diagrams: API Request Flow, Event-Bus and BullMQ Flow)
- `.cursor/rules/core-be-src-architecture.mdc` (Cursor rule enforcement hints)
- `.cursor/skills/domain-generator/SKILL.md` (scaffolding conventions)
- `.cursor/skills/workers-events/SKILL.md` (events/queues/workers conventions)
- `.cursor/skills/supabase-porting/SKILL.md` (Supabase porting)
- `.cursor/skills/db-migration-maintainer/SKILL.md` (SQL migrations)
- `.cursor/skills/test-generator/SKILL.md` (testing pyramid and layout)
- `.cursor/skills/openapi-route-sync/SKILL.md` (OpenAPI route metadata)
- `.cursor/skills/cursor-global-skills/SKILL.md` (Cursor built-in skills reference)
- `.cursor/skills/route-catalog/SKILL.md` (route listing conventions)
- `.cursor/skills/code-quality-guard/SKILL.md` (ESLint, pre-commit, CI security pipeline)
- Any other `.cursor/skills/*/SKILL.md` that references paths or layer names
- **Docs**: When docs are reorganized or renamed, run **docs-maintainer** to update `docs/README.md` and cross-links (see `.cursor/skills/docs-maintainer/SKILL.md`).
- **Load-test docs**: `docs/reference/testing/load-testing.md` and `src/tests/load/k6/README.md` must stay in sync when k6 scenarios (`src/tests/load/k6/scenarios/*.js`), load-test scripts (`src/scripts/admin/load-test-credentials.ts`, `src/scripts/admin/admin-token.ts`), or npm scripts (`load:health`, `load:auth`, `tool:load-test-credentials`, `tool:admin-token`; legacy `scripts:*`) change.

## Checklist (run every time)

1. **Scan for drift**
   - Search for old folder/layer names (e.g. `handlers/`, `repos/`, `schemas/`, `guards/`, `plugins/`) and update references.
   - Ensure examples use current filenames: `*.controller.ts`, `*.repository.ts`, `*.validator.ts`, `*.dto.ts`, `*.serializer.ts`.

2. **Confirm dependency boundaries**
   - Controllers import services (or container deps) only (no repositories/database).
   - Services import own repositories/validators + shared errors/core utilities.
   - Repositories import database connection/schemas + own domain types only.

3. **Confirm naming conventions**
   - Full names in code and file names (`repository`, `organization`, `database`, `request`).
   - Sub-domain directories use domain prefix.

4. **Update rule text**
   - Ensure `.cursor/rules/core-be-src-architecture.mdc` matches the current structure and naming.

5. **Verify**
   - `pnpm typecheck`
   - `pnpm test` (or at least ensure tests compile if integration is skipped)

## Output expectation

When invoked, return:

- A list of structure changes detected
- Exact file updates made (docs/rules/skills)
- Any follow-up suggestions (optional)
