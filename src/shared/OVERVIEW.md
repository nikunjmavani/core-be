`src/shared/`

# Shared

## Purpose

Cross-cutting, domain-agnostic building blocks imported by every other layer: environment
config, the typed error hierarchy, truly cross-cutting types, constants, utility helpers,
Fastify middlewares, and i18n locales. This layer carries **no business logic and no domain
knowledge** — it is the leaf that controllers, services, repositories, and infrastructure all
depend on.

Sub-areas: `config/`, `errors/`, `types/`, `constants/`, `utils/` (sub-categorized), `middlewares/`,
`locales/`.

## Design decisions

- **A dedicated shared layer with a one-way import rule.** `shared/` may be imported by any layer but
  must not import from `domains/` or `infrastructure/`. Keeping it a dependency leaf is what prevents
  import cycles across the codebase; the rule is enforced by the import-path global test.
- **`utils/` is sub-categorized into nine folders, not one flat directory.** `auth/`, `http/`, `i18n/`,
  `idempotency/`, `identity/`, `infrastructure/`, `security/`, `text/`, `validation/`. With 50+ helpers,
  a flat folder becomes unsearchable; the category encodes intent (e.g. `security/encryption.util.ts`,
  `http/response.util.ts`, `infrastructure/logger.util.ts`) and gives each helper an obvious home.
- **`types/` stays intentionally minimal.** It holds only the genuinely cross-cutting shapes
  (`AuthContext`, `PaginatedResult`). Domain types are co-located per-domain so they evolve with their
  owner; promoting a type here is a deliberate decision, not a default.
- **A typed error hierarchy over ad-hoc throws.** `AppError` (+ `ERROR_CODE_TO_SNAKE`) and its
  subclasses (`ValidationError`, `auth.error.ts`, `ConfigurationError`) give one place to map an error
  to its HTTP status and i18n key, consumed by the global error handler. Call sites throw typed errors;
  the boundary formats them.
- **i18n-first user-facing strings.** Every error `detail`, validation message, and success message
  resolves through i18next keys (English is the source of truth in `locales/en/`, mirrored in
  `locales/es/`), never hardcoded inline English — so the same payload can be localized at the edge.

## Operational concerns

- **Env validation fails fast.** `config/env-schema.ts` (Zod) validates the environment at boot via
  `config/env.config.ts`; a missing or malformed variable refuses to start the process rather than
  failing at first use. `config/load-env-files.ts` layers `.env.<NODE_ENV>` then `.env.local`.
- **Middleware registration is centralized.** `middlewares/index.ts` exports `registerMiddleware()`,
  the single ordered entry point called from `app.ts`; the groups are `core/`, `rate-limit/`,
  `security/`, `session/`, `tenant/`.

## Failure modes

- **Missing locale key** → i18next falls back to the key / English default; the request still
  succeeds (degraded message, not an error).
- **Invalid environment** → Zod validation throws at boot; the process exits before serving traffic.
