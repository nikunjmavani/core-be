`src/tests/e2e/`

# End-to-end tests

## Purpose

The narrow set of full-platform flows we want a single-file regression for: billing onboarding, GDPR data-export + deletion, invitation accept-and-paint. These tests exercise the same Fastify + Postgres + Redis stack as the integration suite, but each test file represents a single user journey from anonymous → action → final state.

Vitest project: `e2e` (configured in [tooling/vitest/projects.ts](tooling/vitest/projects.ts)).

This is intentionally a small suite. The bulk of regression coverage lives in domain-scoped tests (`src/domains/<domain>/__tests__/<domain>.test.ts`) and integration tests (`src/tests/integration/`).

## Test types

- **User journey tests** — onboarding, data export, deletion, etc., each in its own file.

## How to run

```bash
pnpm compose:up && pnpm compose:wait
pnpm db:migrate
pnpm test:e2e
```

## Fixtures and helpers

Same as integration tests — see [src/tests/integration/integration.overview.md](src/tests/integration/integration.overview.md).

## Dependencies

- **Postgres** + **Redis** — required.
- **No outbound HTTP** — Stripe / Resend / S3 calls are mocked.

## Failure modes

- **Flaky billing onboarding** → typically a Stripe stub mismatch; check the contract test in `contract/` for an expected-payload diff.
- **Data export fails to find rows** → cross-domain reads expect minimal seed data; run `pnpm db:seed` before running locally.
