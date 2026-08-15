`src/tests/smoke/`

# Smoke tests

## Purpose

Live API smoke tests that hit a running server (local dev or CI). Used as the final gate in `pnpm verify:base` to confirm the deployed binary actually responds before declaring a build green.

What this suite covers:

- `/livez` + `/readyz` respond (readiness — dependencies connected).
- One canonical route per domain answers without a 5xx: auth (login + `/users/me`), user (settings + notification preferences), tenancy (organizations list), billing (public plans), notify (webhooks list), audit (role-gated logs — 403 for the plain smoke user proves the guard), upload (unknown-id read → 404 proves the path).
- Idempotency middleware is wired (`idempotency.smoke.test.ts` — missing `X-Idempotency-Key` → 422; replaying the same key returns the identical response, no second execution).

There are TWO smoke layers — don't duplicate between them: this Vitest tier (`pnpm test:smoke`, in-process `fastify.inject()` by default, `SMOKE_EXTERNAL=true` for a live server) and the standalone ops sweep `pnpm test:api-smoke` (`src/scripts/ops/api-smoke-test.ts`, live server + seed, broad per-route canonical sweep incl. S3-backed upload presign). Routes needing live provider credentials belong only in the ops sweep.

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
