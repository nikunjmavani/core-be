`src/tests/bench/`

# Benchmarks

## Purpose

Autocannon-driven micro-benchmarks for single endpoints. Used to detect catastrophic latency regressions on the platform's hottest paths (`/health`, `/auth/me`, the cached permission read path).

What this suite covers:

- Per-endpoint throughput under low / moderate concurrency.
- Latency distribution at the route level (p50 / p95 / p99).

What it does **not** cover: full-request mix (load suite), function-level micro-benchmarks (use a dedicated bench framework when needed).

## How to run

```bash
pnpm test:bench                       # runs all benches
pnpm test:bench -- --duration=30      # 30-second run
```

## Fixtures and helpers

- Autocannon is invoked against a booted dev server; helpers in this folder format and compare results.

## Dependencies

- **Live local server** — `pnpm dev` in another terminal first.

## Failure modes

- **Bench numbers wildly different from baseline** → likely the dev server hot-reloaded mid-run; restart and re-bench.
- **Bench machine under load** (other processes) → results unreliable; treat as informational only.
