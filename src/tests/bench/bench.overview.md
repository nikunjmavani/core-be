`src/tests/bench/`

# Benchmarks

## Purpose

Autocannon-driven micro-benchmarks for single endpoints. Used to detect catastrophic latency regressions on the platform's hottest paths (`/readyz`, `/auth/me`, the cached permission read path).

What this suite covers:

- Per-endpoint throughput under low / moderate concurrency.
- Latency distribution at the route level (p50 / p95 / p99 — autocannon reports `p97_5`, shown as p95).
- The fixed matrix in `run-benches.ts` (`BENCH_ENDPOINTS`): `/readyz`, public `/billing/plans`, authed `/users/me`, and the permission-cached `/tenancy/organization/memberships` read.

What it does **not** cover: full-request mix (load suite), function-level micro-benchmarks (use a dedicated bench framework when needed).

## How to run

```bash
pnpm test:bench                        # full matrix, 10 connections × 10s per endpoint
pnpm test:bench --only readyz          # one endpoint
pnpm test:bench --duration 30          # longer runs
pnpm test:bench --json                 # machine-readable rows
pnpm test:bench:quick                  # readyz only, 5s
```

## Fixtures and helpers

- `run-benches.ts` spawns `npx autocannon --json` per endpoint (autocannon stays out of the dependency tree), logs in with `DEMO_EMAIL`/`DEMO_PASSWORD` for the authed rows (skipped with a notice when login fails), and prints the summary table. Pure helpers (`summarizeAutocannonRun`, `formatBenchTable`, `parseBenchCliOptions`) are unit-tested in `src/tests/unit/bench/`.
- Exit code is 1 only when an endpoint returns zero 2xx (broken route); latency numbers are informational.

## Dependencies

- **Live local server** — `pnpm dev` in another terminal first.

## Failure modes

- **Bench numbers wildly different from baseline** → likely the dev server hot-reloaded mid-run; restart and re-bench.
- **Bench machine under load** (other processes) → results unreliable; treat as informational only.
