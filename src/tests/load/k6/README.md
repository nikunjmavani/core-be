# k6 load test scenarios

Load tests for the core-be API. Keep this doc in sync with [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md).

## Prerequisites

- **Server**: `RATE_LIMIT_MAX=10000 pnpm dev` — raises the per-IP limit for load testing; plain `pnpm dev` 429s at high VU counts.
- **Postgres + Redis**: Required for auth and org-dependent scenarios (`docker compose up -d` or your own).
- **Database**: `pnpm db:migrate` then choose a seed tier:
  - Single-user scenarios (`api-stress`, `daily-ops`, etc.): `pnpm db:seed:full` (demo user `demo@example.com` / `DemoPassword123!`)
  - Per-VU multi-user scenario (`user-journey`): `pnpm db:seed:loadtest` — seeds 12 orgs × 10 users with full domain data and writes `src/tests/load/k6/data/credential-pool.json` (gitignored; contains passwords)
- **k6**: [Install k6](https://k6.io/docs/get-started/installation/).

## Organization scoping (flat routes)

Org-scoped routes are flat — they carry **no** `/organizations/{organization_id}` path segment and **no** organization id header. The active organization rides the access token's signed `org` claim.

- To run an org-scoped scenario, `TEST_TOKEN` must be scoped to `TEST_ORG_ID`: either mint it already-scoped, or the scenario calls `switchToOrganization(token, TEST_ORG_ID)` for you (the tenancy/billing/permission/idempotency scenarios do this in-flow).
- `helpers/auth.js` exposes the scoping helpers: `switchToOrganization(token, organizationPublicId)`, `switchToPersonal(token)`, and `loginScopedToOrganization(email, password, organizationPublicId)` (login + switch in one call). `authHeaders(token)` returns `Authorization` + `Content-Type` only — no org header.

## Quick runs (no auth)

- `pnpm load:health` — health endpoints
- `pnpm load:stress` — health under stress (up to 100 VUs)
- `pnpm load:breakpoint` — capacity test: ramps arrival rate (10 → 300 req/s) until SLOs break (finds max throughput)
- `pnpm test:bench` — Autocannon on `/readyz`

**Full confidence:** Run `pnpm load:stress` (health) and `pnpm load:stress:api` (API with TEST_TOKEN + TEST_ORG_ID). See [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md#full-confidence-recommended).

**Nightly CI:** [.github/workflows/scheduled-k6-load-slo.yml](../../../../.github/workflows/scheduled-k6-load-slo.yml) (`Scheduled k6 API load & SLO`) — gate on `load:stress`-equivalent and `load:stress:api`-equivalent k6 runs; see [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md#nightly-ci-gate-github-actions).

**Interpreting results:** Running k6 on the **same host** as the API caps throughput and inflates latency through CPU contention — treat single-box numbers as lower bounds and regression signals, not true capacity. See [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md#interpreting-results-co-located-load-generation).

## Scenarios

| Scenario        | File                           | Required env                                             | Command / script                                  |
| --------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Health          | `scenarios/health.js`          | (optional `BASE_URL`)                                    | `pnpm load:health`                                |
| Health stress   | `scenarios/health-stress.js`   | (optional `BASE_URL`)                                    | `pnpm load:stress`                                |
| Health breakpoint | `scenarios/health-breakpoint.js` | (optional `BASE_URL`)                                | `pnpm load:breakpoint`                            |
| API stress      | `scenarios/api-stress.js`      | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:stress:api`                            |
| Auth onboarding | `scenarios/auth-onboarding.js` | `DEMO_EMAIL`, `DEMO_PASSWORD` (or use defaults)          | `pnpm load:auth`                                  |
| Passwordless signup | `scenarios/passwordless-signup.js` | API started with `TEST_MODE=true` (echoes the code); no creds — unique user per run | `pnpm load:signup`                |
| Daily ops       | `scenarios/daily-ops.js`       | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:daily-ops`                             |
| Billing         | `scenarios/billing.js`         | `TEST_TOKEN`, `TEST_ORG_ID` (optional for authed routes) | `pnpm load:billing`                               |
| Webhooks        | `scenarios/webhooks.js`        | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:webhooks`                              |
| RLS concurrency | `scenarios/rls-concurrency-beyond-pool.js` | `TEST_TOKEN`, `TEST_ORG_ID` (optional `DATABASE_POOL_MAX`, `BEYOND_POOL_FACTOR`, `BEYOND_POOL_VUS`) | `pnpm load:rls-concurrency`          |
| Admin           | `scenarios/admin.js`           | `ADMIN_TOKEN`                                            | `pnpm load:admin` (after `pnpm tool:admin-token`) |
| **User journey** | `scenarios/user-journey.js`  | credential pool (see below)                              | `pnpm load:user-journey`                          |

**Obtaining credentials:**

- **TEST_TOKEN + TEST_ORG_ID**: `pnpm tool:load-test-credentials` (server up, full seed) — prints values for copy-paste.
- **ADMIN_TOKEN**: `pnpm tool:admin-token` — prints a JWT with role `super_admin` for load-test use.
- **Credential pool** (user-journey): `pnpm db:seed:loadtest` — no server needed; writes `src/tests/load/k6/data/credential-pool.json` automatically. Each VU logs in as a distinct user so tokens are minted once in `setup()` via `helpers/pool.js`.

**Rate limit:** High-concurrency scenarios (`api-stress`, `rls-concurrency`) exceed the default global limit of `RATE_LIMIT_MAX` (100) requests per `RATE_LIMIT_WINDOW_MS` (60s) per IP, so the server returns `429` and k6 marks the requests as failed. Start the API with `RATE_LIMIT_MAX=10000 pnpm dev` (or `pnpm dev:loadtest`) before running them. The nightly CI workflow already boots the API at `RATE_LIMIT_MAX=10000`.

Full details (env, how to run each scenario): [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md).
