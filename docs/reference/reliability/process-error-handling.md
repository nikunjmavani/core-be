# Process error handling (API and worker)

Production-readiness audit finding **#14** — how `core-be` treats fatal synchronous errors vs unhandled promise rejections.

## Policy summary

| Signal | Handler | Exit behavior |
| ------ | ------- | ------------- |
| **`uncaughtException`** | `server.ts` / `worker.ts` | Always **fatal**: Sentry capture → log → `process.exit(1)` after flush |
| **`unhandledRejection`** | `createUnhandledRejectionHandler()` | **Non-fatal by default**: meter + Sentry + error log; **fatal only on sustained burst** |

Rationale: a single un-awaited promise rejection (including from dependencies) must not drop all in-flight HTTP work. A **sustained burst** within a rolling window indicates a systemic failure and triggers supervisor restart.

## Unhandled-rejection burst thresholds

Implemented in [`unhandled-rejection.handler.ts`](../../../src/infrastructure/observability/unhandled-rejection.handler.ts):

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `UNHANDLED_REJECTION_BURST_WINDOW_MS` | 60_000 | Rolling window for burst detection |
| `UNHANDLED_REJECTION_BURST_THRESHOLD` | 20 | Rejections in-window that trigger fatal exit |

Both the API (`process="api"`) and worker (`process="worker"`) register the same handler with distinct Prometheus labels.

## Observability

- **Metric:** `process_unhandled_rejections_total{process}` — increments on every tolerated rejection.
- **Alerting:** page on a **sustained sub-threshold rate** (persistent failing path that never reaches the burst fatal exit). See [observability runbook](../../deployment/runbooks/observability.md).
- **Sentry:** every rejection is captured with `source=unhandledRejection` or `source=worker_unhandledRejection`.

## Verification

- Unit tests: [`unhandled-rejection.handler.unit.test.ts`](../../../src/infrastructure/observability/__tests__/unit/unhandled-rejection.handler.unit.test.ts)
- Global regression: `pnpm test:global`

## Related

- [health-checks.md](health-checks.md) — liveness vs readiness
- [external-service-resilience.md](external-service-resilience.md) — outbound circuit breakers
- [`src/PATTERNS.md`](../../../src/PATTERNS.md) — network I/O outside RLS database contexts (finding #5)
