---
description: Build a full production-ready vertical slice from a filled requirement intake
argument-hint: <paste the filled full-slice template, or a path to it>
allowed-tools: Bash(pnpm*), Bash(git*)
---

Build a complete, production-ready vertical slice from the requirement intake (**$ARGUMENTS**, or the filled template in the conversation). Follow the "Full-slice template" in `docs/getting-started/requirement-intake.md`.

## 1. Validate the intake first

Parse the 8 sections (summary/placement, data model, public API, business logic, i18n, seed, tests, non-functionals). If any required field is missing or ambiguous, **list the gaps and ask** via `AskUserQuestion` — never guess the data model, auth, or tenancy. Then post the plan once and proceed.

## 2. Run the build pipeline (each step is an existing skill — consult skill-index first)

1. **`/schema-complete`** — schema-generator → sql-design-guard → db-migration-maintainer → rls-tenant-isolation-guard.
2. **domain-generator** — repository → service → controller → dto/validator/serializer/types → container + route registration.
3. **`/route-complete`** — api-contract-guard → route-schema-doc-guard → route-catalog → seed-maintainer (+ openapi-multilingual if tags).
4. **workers-events** — only if the intake declares events/queues/workers.
5. **seed-maintainer** — reference + bulk/faker rows per the intake.
6. **test-generator** — unit + e2e; the intake's test cases become the acceptance tests.
7. **i18n-message-guard**, **tsdoc-export-guard**, **overview-doc-maintainer**, OpenAPI — i18n + docs.

## 3. Autonomous verify → heal loop

Run the gates; on failure, route long output through `headroom_compress`, diagnose, fix, and re-run — until green. **Definition of done:** `pnpm validate` + the route/domain gates + a live `pnpm verify:base` smoke + **`/pre-merge-review`** clean. Escalate (`AskUserQuestion`) **only** on ambiguity, an irreversible/destructive step, a security trade-off, or repeated no-progress failure.

## 4. Emit the reports bundle

Write `docs/builds/<YYYY-MM-DD>-<feature>/`:

- **build-report.md** — files created, decisions, assumptions, any spec deviations.
- **traceability.md** — each intake item → the code + tests that satisfy it.
- **review.md** — the `/pre-merge-review` output.
- **quality.md** — test/tsdoc/route coverage + lint/type status; security notes (RLS/tenant, idempotency, secrets).

Commit per step so the build is resumable. Do **not** open a PR unless asked — when the slice is green, suggest `/ship`.
