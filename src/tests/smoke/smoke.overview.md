`src/tests/smoke/`

# Smoke tests

## Purpose

Live API smoke tests that hit a running server (local dev or CI). Used as the final gate in `pnpm verify:base` to confirm the deployed binary actually responds before declaring a build green.

What this suite covers:

- `/readyz` returns 200 (readiness — dependencies connected).
- A handful of canonical authenticated routes per domain return 200 with the expected response shape.
- Idempotency middleware is wired (same key → same response).

What it does **not** cover: full API behavior (integration), latency (performance / load), failure modes (chaos).

## How to run

```bash
pnpm dev   # in another terminal, or:
pnpm verify:base   # boots server + worker + runs smoke
pnpm test:api-smoke   # standalone smoke run (server must already be up)
```

## Fixtures and helpers

- Standalone helper that opens a real HTTP connection to the server (no `fastify.inject()`).
- Uses the dev seed to obtain a known JWT for authenticated calls.

## Dependencies

- **Running server** at `http://localhost:3000` (or `API_BASE_URL`).
- **Postgres + Redis** behind the server.

## Failure modes

- **Server not booted** → smoke prints a clear error and exits non-zero.
- **Seed missing** → smoke skips the authenticated calls; CI marks as warning rather than fail (configurable).
