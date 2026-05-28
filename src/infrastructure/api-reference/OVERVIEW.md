`src/infrastructure/api-reference/`

# API reference infrastructure

## Purpose

Serves the Swagger / Redoc / Scalar UI on top of the generated OpenAPI document. Mounted at `/docs` (and language-specific paths) when `ENABLE_API_DOCS=true`, or always-on in development. Authenticated when production-locked; public in dev.

## Design decisions

- **Generated, never hand-edited** OpenAPI: the document is built from Zod route schemas + i18n locale files. This module only consumes it.
- **Multiple UIs available**: Scalar (default for new integrations — sleek, fast), Redoc (alternative for those who prefer static reference), Swagger UI (legacy familiarity). All read the same `openapi.json`.
- **Locale-aware**: the document path is `/docs/openapi.{locale}.json`; the UI picks up the user's `Accept-Language` (or explicit query param).
- **Auth gating in production**: `ENABLE_API_DOCS=true` + a JWT preHandler limits access to authenticated platform staff. Self-hosters may flip the flag off entirely.

## Operational concerns

- **Document regeneration**: `pnpm docs:generate` (default locale) or `pnpm docs:generate:multilang` (all locales) writes to `docs/openapi/`. The CI gate `pnpm docs:check` fails if the committed file is stale.
- **Caching**: the generated file is gzipped + cached by the reverse proxy; no cache busting needed because the file lives under a versioned URL.

## External dependencies

- Generated file at `docs/openapi/openapi.json` (or `openapi.{locale}.json`).

## Failure modes

- **OpenAPI file missing on disk** → 404; setup script hint logged. Should never happen in production builds (file is bundled).
- **Doc regeneration drift in CI** → `pnpm docs:check` fails the build until the doc is regenerated.
