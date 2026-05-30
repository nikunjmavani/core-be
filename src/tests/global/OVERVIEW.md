`src/tests/global/`

# Global regression tests

## Purpose

Static / cross-cutting regressions that apply to the whole codebase: domain dependency-rule scans, worker readiness asserts, audit-emission cardinality checks, and similar guardrails that don't fit a single domain.

Vitest project: `global` (configured in [tooling/vitest/projects.ts](tooling/vitest/projects.ts)).

What this suite covers:

- Domain dependency rules (no cross-domain repository imports, no `request-database.context` from workers, etc.).
- Worker readiness — every domain that registers a worker has a corresponding heartbeat and DLQ wiring.
- Auth / audit emission cardinality — every controller path that should emit audit does.
- Schema / route catalog drift detection.
- RLS database context network isolation — no outbound I/O inside `withOrganizationDatabaseContext` callbacks in domain code.

What it does **not** cover: API behavior (see integration / e2e), worker per-job behavior (see integration).

## Test types

- **AST-driven scans** — Walk `src/` and assert structural rules.
- **Module-import scans** — Forbid certain imports under certain paths.

## How to run

```bash
pnpm test:global   # alias: pnpm test:regression
```

No Postgres / Redis required — this suite is static.

## Fixtures and helpers

None — these tests read source files directly.

## Dependencies

- **None** — runs offline. Suitable for the CI quality slice.

## Failure modes

- **New cross-domain repository import sneaks in** → the test prints the offending file + line; refactor through the domain's service.
- **New worker file forgets to register its DLQ** → the readiness scan flags it; wire through [src/infrastructure/queue/dead-letter.ts](src/infrastructure/queue/dead-letter.ts).
- **Route added without `schema` block** → catalog drift caught by sibling `routes:catalog:check`.
