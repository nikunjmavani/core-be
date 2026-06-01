`src/tests/load/`

# Load / SLO tests

## Purpose

k6-based load tests that exercise the platform at production-like RPS and assert against published SLOs (latency p95 / p99, error rate, throughput). Run on a schedule in CI (`scheduled-k6-load-slo.yml`) and locally on demand against a deployed environment.

What this suite covers:

- Per-route SLO compliance (latency + error rate).
- Sustained-load behavior (no memory growth, no connection-pool waiter accumulation).
- Burst behavior (rate limiter, idempotency cache eviction).

What it does **not** cover: function-level latency (see `performance/`), failure-mode behavior (see `chaos/`).

## How to run

```bash
pnpm load:run                     # default scenario
pnpm load:run -- --scenario=auth  # specific scenario
```

## Fixtures and helpers

- Scenarios under `k6/scenarios/` define RPS / VU / duration patterns.
- `k6/lib/` holds shared helpers (auth bootstrap, payload generators).

## Dependencies

- **k6** binary — installed locally or in CI.
- **Live API** — points at `API_BASE_URL`. Default scenarios run against a staging environment, not local.

## Failure modes

- **SLO breach** → CI marks the run as failed; investigate via `pnpm load:report` for per-route breakdown.
- **k6 crash mid-run** → re-run with smaller concurrency; common cause is the test machine running out of file descriptors.

## Related docs

- [docs/reference/testing/load-testing.md](docs/reference/testing/load-testing.md)
