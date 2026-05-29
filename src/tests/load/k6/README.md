# k6 load test scenarios

Load tests for the core-be API. Keep this doc in sync with [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md).

## Prerequisites

- **Server**: Run the API with `pnpm dev` (and optionally `pnpm dev:worker`).
- **Postgres + Redis**: Required for auth and org-dependent scenarios (`docker compose up -d` or your own).
- **Database**: `pnpm db:migrate` and for auth/org scenarios `pnpm db:seed:full` (demo user: `demo@example.com` / `DemoPassword123!`).
- **k6**: [Install k6](https://k6.io/docs/get-started/installation/).

## Quick runs (no auth)

- `pnpm load:health` — health endpoints
- `pnpm load:stress` — health under stress (up to 100 VUs)
- `pnpm test:bench` — Autocannon on `/health`

**Full confidence:** Run `pnpm load:stress` (health) and `pnpm load:stress:api` (API with TEST_TOKEN + TEST_ORG_ID). See [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md#full-confidence-recommended).

**Nightly CI:** [.github/workflows/scheduled-k6-load-slo.yml](../../../../.github/workflows/scheduled-k6-load-slo.yml) (`Scheduled k6 API load & SLO`) — gate on `load:stress`-equivalent and `load:stress:api`-equivalent k6 runs; see [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md#nightly-ci-gate-github-actions).

## Scenarios

| Scenario        | File                           | Required env                                             | Command / script                                  |
| --------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Health          | `scenarios/health.js`          | (optional `BASE_URL`)                                    | `pnpm load:health`                                |
| Health stress   | `scenarios/health-stress.js`   | (optional `BASE_URL`)                                    | `pnpm load:stress`                                |
| API stress      | `scenarios/api-stress.js`      | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:stress:api`                            |
| Auth onboarding | `scenarios/auth-onboarding.js` | `TEST_EMAIL`, `TEST_PASSWORD` (or use defaults)          | `pnpm load:auth`                                  |
| Daily ops       | `scenarios/daily-ops.js`       | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:daily-ops`                             |
| Billing         | `scenarios/billing.js`         | `TEST_TOKEN`, `TEST_ORG_ID` (optional for authed routes) | `pnpm load:billing`                               |
| Webhooks        | `scenarios/webhooks.js`        | `TEST_TOKEN`, `TEST_ORG_ID`                              | `pnpm load:webhooks`                              |
| RLS concurrency | `scenarios/rls-concurrency-beyond-pool.js` | `TEST_TOKEN`, `TEST_ORG_ID` (optional `DATABASE_POOL_MAX`, `BEYOND_POOL_FACTOR`, `BEYOND_POOL_VUS`) | `pnpm load:rls-concurrency`          |
| Admin           | `scenarios/admin.js`           | `ADMIN_TOKEN`                                            | `pnpm load:admin` (after `pnpm tool:admin-token`) |

**Obtaining credentials:**

- **TEST_TOKEN + TEST_ORG_ID**: `pnpm tool:load-test-credentials` (server up, full seed) — prints values for copy-paste.
- **ADMIN_TOKEN**: `pnpm tool:admin-token` — prints a JWT with role `super_admin` for load-test use.

Full details (env, how to run each scenario): [docs/reference/testing/load-testing.md](../../../../docs/reference/testing/load-testing.md).
