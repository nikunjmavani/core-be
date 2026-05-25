# Claude Code Guidelines for core-be

## New requirements — intake format

For **any new requirement** (new domain, routes, worker, schema, etc.), use the format and checklist in **`docs/getting-started/requirement-intake.md`**. That doc defines what details to provide and which skills/rules to invoke so the AI can perform best and keep docs, routes, tests, and lint in sync. Consult **`.cursor/skills/skill-index/SKILL.md`** first, then run the skills listed for the requirement type.

## Architecture Rules (Non-Negotiable)

- HTTP controllers **coordinate**, never enforce invariants
- Services express **intent**, never manage transactions
- Postgres is the **only source of truth**
- Workers are **pull-based**, never push-based
- Cross-domain service imports are **allowed** for READ/WRITE where needed
- Cross-domain reads/writes are handled via service imports (no separate use-cases layer)

## Naming Conventions (Non-Negotiable)

### Full Names Only — No Short Names

- **Never use abbreviations** in variable names, file names, or identifiers.
- Examples: `organization` not `org`, `repository` not `repo`, `identifier` not `id` when standalone, `request` not `req` (except Fastify framework convention), `database` not `db`.
- Framework conventions (e.g. `req`, `reply` in Fastify handlers) may remain.

### Sub-Domain Directory Names — Always Prefix with Domain

- Sub-domain folder **must** include the domain/resource prefix to avoid ambiguity.
- Examples: `user-settings` (under user), `organization-settings` (under organization), `member-role-permission` (under member-roles), `webhook-event` (under webhook).

### Object Parameters Only — Outside Repositories

- Any function or method authored in `src/**/*.ts` with **two or more inputs** must take a **single named options object** (interface/type + destructuring).
- **Exempt files**: `*.repository.ts` and `*.repository.unit.test.ts` keep positional params (e.g. `findByUserAndOrganization(user_id, organization_id)`).
- **Exempt signatures** (framework-mandated, stay positional): Fastify handlers `(request, reply)`, Fastify plugins `(app, options)`, BullMQ processors `(job)` / `(job, token)`, DI constructors in `*.container.ts`, event-bus subscribers, `Array.sort` comparators, Vitest callbacks (`describe(name, fn)`, `it(name, fn)`), Zod refine callbacks.
- See `.cursor/rules/object-params.mdc` for the full guide and worked examples.

## Domain Structure

Domains live under `src/domains/<domain>/`. Each domain has sub-domains with this layout:

### Canonical layout

```text
src/domains/<domain>/
  <domain>.routes.ts          # Route registration (FastifyPluginAsync)
  <domain>.container.ts       # DI container (repos → services); export services for routes/controllers
  events/                     # Optional: register<Domain>EventHandlers() aggregator
    index.ts
  __tests__/                  # Domain e2e, domain-level unit, domain factories (see Testing)
    <domain>.test.ts
    factories/                # Optional: cross-sub-domain test helpers (e.g. tenancy permission.factory)
    unit/
  sub-domains/                # Multi-resource domains only (omit for audit, upload)
    <sub-domain>/             # Top-level resource (sibling under sub-domains/)
      <sub-domain>.controller.ts
      <sub-domain>.service.ts
      <sub-domain>.repository.ts
      <sub-domain>.dto.ts
      <sub-domain>.validator.ts
      <sub-domain>.serializer.ts
      <sub-domain>.types.ts
      <sub-domain>.schema.ts  # When this resource owns tables
      __tests__/              # Sub-domain unit, nested e2e (see Testing)
        unit/
        <sub-domain>.test.ts  # Optional: dedicated route suite (tenancy org children)
      events/                 # Optional: types, handlers, *-emit.ts
        __tests__/            # Event-handler / emit unit tests
      queues/                 # Optional: BullMQ enqueue helpers
      workers/                # Optional: BullMQ processors
      <nested-sub-domain>/    # Optional: aggregate child (lifecycle tied to parent)
        <nested-sub-domain>.controller.ts
        ...                   # Same layer files as parent sub-domain
        __tests__/unit/       # Tests co-located on the nested resource
```

**Import path:** `@/domains/<domain>/sub-domains/<sub-domain>/...` or, for nested children, `@/domains/<domain>/sub-domains/<parent>/<nested>/...`.

Flat domains (`audit`, `upload`) keep layers at domain root (no `sub-domains/`). Bundled domains (`auth`, `user`) use `sub-domains/` for resources; domain root may also have `<domain>.controller.ts`, `<domain>.service.ts`, etc.

### Domain and sub-domain mapping

| Domain (folder) | Sub-domains (folders)                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **audit**       | (single domain, no sub-domains)                                                                                                                                                 |
| **auth**        | auth-method (magic-link, oauth as services in auth-method/), auth-session, auth-mfa, auth-webauthn                                                                              |
| **user**        | user-settings, user-notification-preferences, user-data-export                                                                                                                  |
| **tenancy**     | organization (organization-settings, organization-notification-policy, organization-api-key), membership (member-invitation), member-roles (member-role-permission), permission |
| **billing**     | plan, subscription, stripe-webhook                                                                                                                                              |
| **notify**      | notification, webhook (webhook-event)                                                                                                                                           |
| **upload**      | (single domain, no sub-domains)                                                                                                                                                 |

**Permission resolution** (tenancy domain, not under `shared/`):

- `src/domains/tenancy/sub-domains/permission/authorization.service.ts` — resolve user organization permissions (Redis-cached)
- `src/domains/tenancy/sub-domains/permission/permission-cache.service.ts` — Redis cache helpers for permission sets

### File naming

- Domain/sub-domain folders: **singular** or **kebab-case** for multi-word (`member-roles`, `member-invitation`).
- Files inside a sub-domain: **singular** for the main resource (`user.service.ts`, `organization.repository.ts`).
- Controllers export: `create<Resource>Controller(service)` or `create<Resource>Controller(container)` when multiple sub-domain services are wired.
- Always prefix sub-domain directories with parent domain name.

### Sub-domain nesting (sub-domains may contain sub-domains)

A **top-level sub-domain** is a direct child of `sub-domains/<name>/`. A **nested sub-domain** is a folder inside a parent sub-domain when the child’s lifecycle is tied to the parent aggregate.

| Rule                                                                                      | Example                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Sibling resources** live under `sub-domains/` only                                      | `sub-domains/plan/`, `sub-domains/subscription/`                                    |
| **Nested sub-domains** live inside the parent sub-domain folder                           | `sub-domains/webhook/webhook-event/`                                                |
| **Organization children** nest under `organization/`                                      | `sub-domains/organization/organization-api-key/`, `organization-settings/`          |
| **Membership / member-roles children** nest under parent                                  | `sub-domains/membership/member-invitation/`, `member-roles/member-role-permission/` |
| **Prefix** multi-word names with domain/resource name                                     | `organization-settings`, `member-invitation`, `webhook-event`                       |
| **Implementation modules** (not separate API resources) stay as services in parent folder | `auth-method/magic-link.service.ts`, `oauth/` under `auth-method/`                  |
| Prefer depth ≤ 4 under `domains/<domain>/` for new work                                   | Flatten if a nested folder has no distinct routes or tests                          |

Nested resources use the **same layer files** (controller, service, repository, validator, serializer, dto, types, schema) and the **same optional** `events/`, `queues/`, `workers/`, `__tests__/` as top-level sub-domains.

See **`docs/reference/architecture/domains-and-public-api-design.md`** for route strategies, tests, and examples.

## Infrastructure

```text
src/infrastructure/
  database/
    connection.ts             # Exports: database, sql, closeDatabase
    base-repository.ts        # Abstract BaseRepository with paginate()
    transaction.ts            # withTransaction() helper
    migrate.ts                # Migration runner
    pg-schemas.ts             # Shared pgSchema definitions (auth, tenancy, billing, notify, audit, upload)
  cache/
    redis.client.ts           # Redis connection (managed service)
  queue/
    connection.ts             # Re-exports Redis for BullMQ + getBullMQConnectionOptions()
    health.ts                  # BullMQ readiness helper (notification queue client ping)
    worker-options.ts         # Shared stall / lock tuning for workers
    dead-letter.ts            # Per-source `<queue>-dlq` + final-retry Sentry from bootstrap
    bootstrap.ts              # Registers repeatable jobs + starts domain workers; attaches DLQ hooks
    scheduler.ts              # Central BullMQ repeatable-job registry (cron index for retention workers)
  mail/
    mail.service.ts           # Resend email service
    mail-outbox.schema.ts     # Transactional outbox table (shared infrastructure pattern)
    mail-outbox.repository.ts # Outbox persistence (not domain-owned)
    templates/                # HTML email templates (base, magic-link, invitation)
    queues/
      mail.queue.ts           # BullMQ queue + enqueueEmail()
    workers/
      mail.worker.ts          # BullMQ processor for email delivery
  payment/
    stripe.client.ts          # Stripe SDK client + helpers (customer, subscription, webhook)
  storage/
    storage.service.ts        # S3 storage service (presigned URLs, head object)
  observability/
    sentry.ts                        # Sentry: errors, tracing, continuous profiling (V8 CpuProfiler), structured logs
    idempotency-cardinality.constants.ts  # BullMQ queue name for idempotency Redis cardinality sampling
    idempotency-cardinality.service.ts    # Bounded SCAN + threshold log / Sentry
    idempotency-cardinality.worker.ts     # Worker processor (repeatable schedule in queue/scheduler.ts)
  mcp/
    mcp-server.ts             # MCP (ENABLE_MCP_SERVER, dynamic import; @modelcontextprotocol/sdk optionalDependency): POST /api/v1/mcp
```

## Shared

```text
src/shared/
  config/
    env.config.ts             # Environment validation (Zod)
  errors/
    app.error.ts              # Base AppError + ERROR_CODE_TO_SNAKE
    validation.error.ts       # ValidationError
    auth.error.ts             # NotFoundError, UnauthorizedError, etc.
    index.ts                  # Re-exports all
  types/
    index.ts                  # AuthContext, PaginatedResult
  constants/
    index.ts                  # PAGINATION, SLUG_REGEX, UUID_REGEX
  utils/
    logger.util.ts            # Pino logger
    response.util.ts          # successResponse, paginatedResponse
    api-versioning.util.ts    # buildPublicApiPrefix; applyDeprecatedEndpointHeaders (Sunset / Deprecation)
    request.util.ts           # getRequestIdentifier, requireAuth (shared controller helpers)
    authorization.util.ts     # requireRole, requireOrganizationPermission preHandlers
    pagination.util.ts        # paginationSchema, cursorPaginationSchema
    public-id.util.ts         # generatePublicId
    uuid.util.ts              # uuidSchema
  middleware/
    compress.middleware.ts     # gzip/brotli response compression
    auth.middleware.ts         # JWT verify, req.auth
    tenant.middleware.ts       # X-Organization-Id → req.organizationId
    cors.middleware.ts
    helmet.middleware.ts
    rate-limit.middleware.ts   # Global + per-route rate limits
    error-handler.middleware.ts  # Error formatting + Sentry capture
    response-format.middleware.ts
    request-context.middleware.ts
    idempotency.middleware.ts  # Idempotency-Key header (Redis-backed, 24h TTL)
    health.middleware.ts
    shutdown.middleware.ts
    index.ts                  # registerMiddleware()
  locales/
    en/, es/                  # errors.json, success.json, common.json; openapi.json for docs:generate
```

## Queue Infrastructure — Domain-Owned Jobs and Processors

- **Infrastructure only**: Connection (Redis), **scheduler** (repeatable retention cron registry), **bootstrap** that registers schedulers and starts each worker.
- **Jobs and processors**: Live in **respective domains only** — never in `common` or `shared`.
- Layout:
  - `infrastructure/queue/`: `connection.ts`, `health.ts`, `scheduler.ts` (all `upsertJobScheduler` calls for retention), `dead-letter.ts` (per-queue `<name>-dlq` + final-failure Sentry), `bootstrap.ts`
  - `domains/<domain>/<sub-domain>/queues/*`: Queue definition + enqueue helpers
  - `domains/<domain>/<sub-domain>/workers/*`: BullMQ processor(s)
- **No** `infrastructure/queue/processors/` — processors live in domains.

## Domain events (in-process) vs BullMQ workers

These are **not** the same:

- **Event bus** (`src/core/events/event-bus.ts`): in-process, runs in the API process immediately after a successful service write. Handlers enqueue side effects and **must not** fail the HTTP request.
- **BullMQ workers** (`src/infrastructure/queue/bootstrap.ts`, `pnpm dev:worker`): async, durable jobs in Redis processed in a separate worker process (retries, DLQ).

Typical flow: `service` → `eventBus.emit` → handler → `enqueueEmail()` → mail worker. Direct `enqueueEmail()` from a service (without the bus) is also valid for simple side effects.

- **Registration (two paths)** — bootstrap order matters:
  1. `buildApp()` → `registerEventHandlers()` ([`register-event-handlers.ts`](src/core/events/register-event-handlers.ts)) **before** routes — auth + tenancy email handlers only.
  2. `registerRoutes()` → [`domain-containers.plugin.ts`](src/domains/domain-containers.plugin.ts) → `registerNotifyContainer()` — notify handlers that need `WebhookRepository` from DI.
- **Rule:** Handlers that only need `enqueueEmail()` or no container deps → register via `register-event-handlers.ts`. Handlers that need repositories from the composition root → register in the domain’s `register*Container()` (notify today).
- **Example (core path):** `tenancy/sub-domains/membership/member-invitation/` — service emits; handler calls `enqueueEmail()`.
- **Example (container path):** `notify/events/notify.event-handlers.ts` — `registerBillingWebhookEventHandlers({ webhookRepository })`, webhook delivery enqueue, billing subscription notifications.

| Registrar                               | Event types (examples)                                                    | Side effect                            |
| --------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| `registerAuthMethodEventHandlers`       | `AUTH_EVENT.MAGIC_LINK_REQUESTED`, password reset, email verification     | Mail queue                             |
| `registerMemberInvitationEventHandlers` | `MEMBER_INVITATION_EVENT.CREATED`, `RESENT`                               | Mail queue                             |
| `registerNotifyEventHandlers`           | `NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED`, `BILLING_EVENT.SUBSCRIPTION_*` | BullMQ notification / webhook delivery |

Billing event helpers and types live with the billing sub-domains that emit them — listeners live under notify.

## Key Patterns

- **Route flow**: HTTP Request → Middleware → Controller → Service → Repository
- **DI flow**: Container (repos → services) → Routes (controllers) → `src/routes.ts` (domain containers + route registration)
- **API versioning**: Major versions use `/api/v1`, …; deprecation policy and standard `Sunset` / `Deprecation` response headers — see **`docs/reference/api/api-versioning.md`** and `src/shared/utils/http/api-versioning.util.ts`.
- **Data lifecycle**: Soft-delete (`deleted_at`), revocation vs immutable billing ledgers, session/audit retention — see **`docs/reference/data/data-lifecycle-deletion.md`**.
- **Controllers**: Thin layer; export `create<Resource>Controller(service)` or `create<Resource>Controller(container)` returning handler map. Use `getRequestIdentifier()` and `requireAuth()` from `@/shared/utils/http/request.util.js`.
- **Validation**: DTO (Zod schemas in `.dto.ts`), Validator (function-based, calls `.safeParse()`, throws `ValidationError`)
- **Serializer**: Function-based response shaping in `.serializer.ts` (e.g. `serializeOrganization(row)`)
- **Containers**: `<domain>.container.ts` handles DI; export services for routes/controllers. Multi-sub-domain domains (auth, user, billing, tenancy) wire sub-domain services via the container — controllers call the appropriate service directly.
- **Errors**: Typed errors from `src/shared/errors/index.ts`
- **Responses**: Helpers from `src/shared/utils/http/response.util.ts` (`successResponse`, `paginatedResponse`) + global formatting in `src/shared/middlewares/error-handler.middleware.ts`
- **i18n**: All user-facing response messages (error `detail`, validation `errors[].message`, success `message`) go through i18next. Use translation keys in errors and success payloads; error handler and controllers translate with `request.t()`. English is the default locale; add new keys to `src/shared/locales/en/` first, then other locales. See **`docs/reference/runtime/internationalization.md`**.
- **Request helpers**: `src/shared/utils/http/request.util.ts` exports `getRequestIdentifier(request)` and `requireAuth(request)` — use these in ALL controllers.
- **Auth**: Fastify auth plugin in `src/shared/middlewares/auth.middleware.ts`, decorates `request.auth` (JWT RS256 via `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`). Session cookie (`session_id`) CSRF model and Origin checks for refresh: **`docs/reference/security/csrf-and-session-cookies.md`**
- **Tenant**: `X-Organization-Id` header → `request.organizationId` via `src/shared/middlewares/tenant.middleware.ts`
- **Organization context / RLS**: Organization context is set only for HTTP requests via tenant middleware (`X-Organization-Id` → Postgres session variable `app.current_organization_id` for RLS). Workers and processors must not call or import `getRequestDatabase()` (enforced by global tests and code review; do not import `request-database.context` under `*.worker.ts` / `*.processor.ts`). Use context wrappers (`withOrganizationContext`, `withGlobalRetentionCleanupDatabaseContext`, `withUserDatabaseContext`, `withSessionRetentionCleanupDatabaseContext`) and pass the returned `databaseHandle` into `createWorker*Repository(databaseHandle)` factories or `runTenantScopedWorkerJob` / `runGlobalRetentionWorkerJob` / `runUserScopedWorkerJob` from `src/infrastructure/queue/worker-processor.util.ts`. Tenant-scoped jobs must include `organizationPublicId` in the job payload. See `src/infrastructure/database/retention-database.context.ts` and migration `20260530000001_global_retention_cleanup_rls.sql`.
- **DB**: `src/infrastructure/database/connection.ts` singleton + Drizzle queries in repositories; repositories may extend `src/infrastructure/database/base-repository.ts` for `paginate()`
- **Config**: Environment variables from `src/shared/config/env.config.ts`. Env files are **root only**: `.env.example` is the single committed template; per-environment `.env.<environment>` files (e.g. `.env.development`, `.env.production`) are gitignored. Hosted environment mapping lives in `.github/sync.config.json` (edit by hand when adding/removing environments). Scaffold and push with `pnpm github:sync`. Consistency and remote drift: `pnpm github:sync --check`. Runtime loader (`src/shared/config/load-env-files.ts`) reads `.env.${NODE_ENV ?? 'development'}`.

## Dependency Rules

- HTTP controllers may import: services (or container deps), `@/shared/utils/http/request.util.js`, `@/shared/utils/http/response.util.js`, shared errors
- Services may import: own domain repositories, own domain validators, own domain types, shared errors, `src/core/events/event-bus.ts`, `src/shared/utils/infrastructure/logger.util.ts`
- Services may import other domains’ **services** for cross-domain reads/writes. Cross-domain **repository** imports from services are forbidden.
- Repositories may import: DB connection, schema, own domain types; may extend BaseRepository. Repositories may import other domains’ **schemas** for joins only (same bounded context or documented exception).
- **Documented exception**: `user-data-export` may use direct DB + cross-domain schema reads for GDPR export until refactored.
- Containers may import: own domain repositories, services. Accept cross-domain deps as parameters. Export services for route registration.
- Routes may import: own domain controllers, container types. Must use `FastifyPluginAsync` pattern.

## Drizzle ORM Conventions

- **Always use `snake_case`** for column property names in Drizzle schema definitions
- Column names must match the actual Postgres column names exactly
- Table names: plural, snake_case (`organizations`, `subscriptions`)
- Schema files are **co-located in domains**: `src/domains/<domain>/<sub-domain>/<sub-domain>.schema.ts`
- Shared `pgSchema` definitions live in `src/infrastructure/database/pg-schemas.ts`

## Seeding

- **Domain seeds**: Entity seed logic and reference data live in `src/domains/<domain>/.../*.seed.ts` (e.g. `permission.seed.ts`, `plan.seed.ts`, `user.seed.ts`, `tenancy.seed.ts`). No cross-domain insert logic inside domains.
- **Orchestration and common flows**: `src/scripts/seed/minimal.ts` and `full.ts` only — they call domain seeds and implement cross-domain flows (add user to organization, send invite). No duplicate permission/plan lists or entity insert helpers in scripts/seed.
- **Route alignment**: Seed data should support what the API exposes. When routes are added, removed, or updated, run **route-catalog** skill (`pnpm routes:catalog`) and **seed-maintainer** so seeds stay aligned with routes.

## Context7 (version-wise backend docs)

This repo uses **Context7 MCP** for up-to-date, version-specific documentation. Scope is **backend only** (Fastify, Drizzle, BullMQ, Postgres, Node). Add `use context7` to prompts when asking about library APIs or setup; mention versions (e.g. Fastify 5, Drizzle 0.45) for version-specific docs.

## Keeping Docs and Skills in Sync

When **code or architecture changes**, consult **`.cursor/skills/skill-index/SKILL.md` first** — it maps what changed to which skill(s) to run (no duplicate invocations).

**Enforcement:** Agent skills generate/fix artifacts once → pre-commit (`lint-staged`, `typecheck`, `validate:domain`) → CI (`pnpm validate`, `routes:catalog:check`, env-example sync).

**Human docs** (when layout changes): `CLAUDE.md`, `README.md`, `.cursor/rules/`, skills — via **structure-maintainer**. Hand-written `docs/**/*.md` — via **docs-maintainer**.

All skills live under `.cursor/skills/`; the skill-index trigger map and auto-trigger rules table are the canonical list.

## Testing

- **Test framework**: Vitest + `fastify.inject()` (helpers in `src/tests/helpers/test-http-inject.helper.ts`)
- **Cross-cutting tests**: `src/tests/` — helpers, shared factories, security, performance, chaos, contract; k6 under `src/tests/load/k6/`
- **Domain tests** (co-located with code):
  - **Bundled e2e**: `src/domains/<domain>/__tests__/<domain>.test.ts` (auth, billing, notify, user, tenancy, audit, upload)
  - **Domain unit / policy scans**: `src/domains/<domain>/__tests__/unit/` (e.g. ledger immutability, tombstone reads)
  - **Domain factories**: `src/domains/<domain>/__tests__/factories/` when helpers span sub-domains (e.g. `tenancy/__tests__/factories/permission.factory.ts`)
  - **Sub-domain unit**: `sub-domains/<resource>/__tests__/unit/*.validator.test.ts` (or nested: `sub-domains/<parent>/<child>/__tests__/unit/`)
  - **Sub-domain e2e** (when split from monolith): `sub-domains/<parent>/<child>/__tests__/<child>.test.ts` (e.g. organization-api-key)
  - **Event handlers / emit**: `sub-domains/<resource>/events/__tests__/` (register leaf handlers only in tests)
- **Commands**: `pnpm test:unit` (unit + `events/__tests__`), `pnpm test:e2e` (excludes `__tests__/unit/` and `events/__tests__`), `pnpm test` (all)
- **Detail**: `.cursor/skills/test-generator/SKILL.md`, `.cursor/rules/testing-conventions.mdc`
- **Chaos suite**: `src/tests/chaos/**/*.chaos.test.ts` — see **`docs/reference/reliability/chaos-testing.md`**
- **Contract tests**: `src/tests/contract/**` — see **`docs/reference/testing/contract-tests.md`**
- **k6 load tests**: `src/tests/load/k6/scenarios/` — see **`docs/reference/testing/load-testing.md`**

## Commands

Script namespaces: `ci:*`, `compose:*`, `test:*`, `db:*`, `docs:*`, `routes:*`, `load:*`, `chaos:*`, `tool:*`, `setup:infra:*`, `security:*`, `deps:*`. Legacy: `route-catalog`, `scripts:*`. List all: `pnpm run`.

- `pnpm build` — compile to `dist/` (`tsc` + `tsc-alias`); `pnpm build:check` fails if `@/` aliases remain
- `pnpm dev` — run Fastify server (tsx watch)
- `pnpm dev:worker` — run BullMQ worker process (tsx watch)
- `pnpm lint` — run Biome (lint + format check on `src/` and `tooling/`)
- `pnpm format` — run Biome formatter (`biome format --write`)
- `pnpm typecheck` — TypeScript type check
- `pnpm compose:up` / `pnpm compose:down` — start/stop Postgres + Redis (Docker Compose)
- `pnpm compose:wait` — wait until Compose Postgres accepts connections (fails fast if service not running)
- `pnpm db:migrate` — run SQL migrations from `migrations/`
- `pnpm db:migrate:lint` — scan `migrations/*.sql` for migration-safety violations (blocking DDL, missing IF NOT EXISTS, etc.)
- `pnpm docs:generate` — generate OpenAPI spec to `docs/openapi/openapi.json` (default locale en) or `docs/openapi/openapi.{locale}.json` when `OPENAPI_LOCALE` is set (gitignored)
- `pnpm docs:generate:multilang` — generate OpenAPI specs for all locales (en, es) from `src/shared/locales/{locale}/openapi.json`; see **openapi-multilingual** skill
- `pnpm docs:check` — verify OpenAPI generator output is in sync (works on fresh clones; specs are gitignored)
- `pnpm docs:postman` — convert OpenAPI spec to Postman Collection at `docs/postman-collection.json`
- `pnpm docs:upload` — upload Postman Collection to workspace (requires `POSTMAN_API_KEY` + `POSTMAN_WORKSPACE_ID`)
- `pnpm docs:all` — generate OpenAPI spec + Postman Collection in one step
- `pnpm test` — run all Vitest tests (serial)
- `pnpm test:unit` — unit only (`--project unit` in `tooling/vitest/projects.ts`: `src/tests/unit` + domain `__tests__/unit/`)
- `pnpm test:integration` — `src/tests/integration`
- `pnpm test:e2e` — domain route tests (excludes `__tests__/unit/`)
- `pnpm test:global` — global regression (`src/tests/global`; alias `pnpm test:regression`)
- `pnpm test:coverage` — all tests with V8 coverage (CI)
- `pnpm test:performance` — performance tests
- `pnpm test:security` — security test suite
- `pnpm test:chaos` — Toxiproxy chaos / fault-injection suite (`tooling/vitest/chaos.config.ts`; see `docs/reference/reliability/chaos-testing.md`)
- `pnpm test:contract` — outbound HTTP contracts for Stripe, Resend, S3 (`tooling/vitest/contract.config.ts`; see `docs/reference/testing/contract-tests.md`)
- `pnpm chaos:up` / `pnpm chaos:down` — start/stop the Toxiproxy sidecar (`docker compose --profile chaos`)
- `pnpm chaos:provision` — register Postgres + Redis listener proxies (`src/tests/chaos/provision-proxies.ts`)
- `pnpm test:api-smoke` — live API smoke (server running + seed)
- `pnpm verify:base` — end-to-end gate: migrate → seed (minimal + full) → API smoke (auto-detects/launches server + worker) → validate
- `pnpm routes:catalog` / `pnpm routes:catalog:check` — regenerate or verify `docs/routes.txt` (legacy: `route-catalog`, `route-catalog:check`)
- `pnpm ci:local` — PR gate: validate + domain + routes + migrate lint + env example + full test
- `pnpm ci:quality` — static CI quality slice (audit, validate, domain, contract tests, routes, env example, migrate lint)
- `pnpm validate` — lint + format:check + typecheck
- `pnpm test:bench` — autocannon single-endpoint benchmark
- `pnpm validate:domain` — validate domain structure (CI gate)
- `pnpm deps:audit` — run `pnpm audit` (must pass; CI fails on any vulnerability)
- `pnpm deps:update` — safe patch/minor updates within ranges; run audit + validate + test after
- `pnpm db:seed` — seed minimal dev data
- `pnpm db:seed:full` — seed full demo data
- `pnpm github:sync` — consistency, scaffold, branches, rulesets, GitHub Environments, push `.env.<environment>` values; `--check` read-only; `--dry-run` preview
- `pnpm tool:sync-env-example` — report env schema vs .env.example diff and PR snippet; use `--fix` to append missing vars (legacy: `scripts:sync-env-example`, `validate:env-example`)
- `pnpm tool:project-structure-tree` — print `src/` directory tree to stdout (see `docs/reference/architecture/project-structure-guide.md`)
