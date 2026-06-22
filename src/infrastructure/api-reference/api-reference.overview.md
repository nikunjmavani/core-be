`src/infrastructure/api-reference/`

# API reference infrastructure

## Purpose

Serves the **Scalar** API Reference UI on top of the generated OpenAPI document, mounted at
`GET /reference` (under the app's global prefix). Registered only when `ENABLE_API_REFERENCE=true`
(default `false`); a no-op otherwise. The route is **unauthenticated** when enabled — there is no
auth preHandler. Exposing it in production is a deliberate, two-flag opt-in: boot validation rejects
`ENABLE_API_REFERENCE=true` under `NODE_ENV=production` unless `API_REFERENCE_ALLOW_PRODUCTION=true`
is also set, because the UI publishes the full API contract (every route, param, and error shape)
without authentication.

## Design decisions

- **Generated, never hand-edited** OpenAPI: the document is built from Zod route schemas + i18n
  locale files. This module only consumes it.
- **Scalar is the only UI** wired here (sleek, fast). No Redoc or Swagger UI is registered.
- **Spec read lazily from disk per request**: the document is loaded from `OPENAPI_SPEC_PATH`
  (default `docs/openapi/openapi.json`) on each request via Scalar's `content` callback, so a
  regenerated spec is picked up without an in-memory cache or a restart.
- **Config-gated instead of auth-gated**: rather than bolt a bespoke JWT preHandler onto the docs
  UI, exposure is controlled entirely by configuration — off by default, and a hard boot failure in
  production unless an operator explicitly opts in via `API_REFERENCE_ALLOW_PRODUCTION=true`. This
  keeps the API surface's strict auth model uncluttered while making accidental prod exposure
  impossible without a deliberate second flag.
- **CSP/COEP relaxed for the `/reference` subtree only** (sec-C/M finding #30): Scalar loads fonts
  and bundle chunks from CDNs at runtime, which the global `Cross-Origin-Embedder-Policy:
  require-corp` blocks. The relaxation is scoped to `/reference`; the API surface keeps the strict
  helmet defaults.

## Operational concerns

- **MCP discoverability**: when `ENABLE_MCP_SERVER` is also on, an HTML comment pointing at
  `/api/v1/mcp` is appended to the rendered `/reference/` page.
- **Document regeneration**: `pnpm docs:generate` (default locale) or `pnpm docs:generate:multilang`
  (all locales) writes to `docs/openapi/`. The CI gate `pnpm docs:check` fails if the committed file
  is stale.
- **Multilingual specs**: `docs:generate:multilang` emits `openapi.{locale}.json` per locale, but
  this module serves the single document at `OPENAPI_SPEC_PATH` — point that env var at a specific
  locale file to serve a localized contract.

## External dependencies

- `@scalar/fastify-api-reference` for the UI.
- Generated spec file on disk at `OPENAPI_SPEC_PATH` (default `docs/openapi/openapi.json`).

## Failure modes

- **OpenAPI file missing on disk** → the content loader throws on the request with a
  `Run pnpm docs:generate to produce docs/openapi/openapi.json` hint. Should never happen in
  production builds (the file is bundled).
- **Doc regeneration drift in CI** → `pnpm docs:check` fails the build until the doc is regenerated.
