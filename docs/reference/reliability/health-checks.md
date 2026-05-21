# Health checks

All health routes return **raw JSON** (no API envelope). They are excluded from i18n and rate limiting (`/health/*` allowlist).

## Four-endpoint convention (API process)

| Route | Purpose | Orchestrator use |
| ----- | ------- | ---------------- |
| `GET /health/live` | Process is up (no dependency checks) | **Liveness** — Railway crash detection, k8s liveness |
| `GET /health/ready` | Postgres, Redis, BullMQ + operational signals | **Readiness** — load balancer pool, deploy smoke |
| `GET /health` | Aggregate: liveness + dependency connectivity | **Human debugging only** (deprecated; see below) |
| `GET /health/worker` | API-side view of worker dependencies + queue heartbeats | **Human / post-deploy**; does not replace worker HTTP probe |

Worker replicas run a separate HTTP server on `WORKER_HEALTH_PORT` (default **9090**) — see [Worker HTTP server](#worker-http-server-worker_health_port).

Implementation: [`health.middleware.ts`](../../../src/shared/middlewares/health.middleware.ts) (API), [`worker-health.server.ts`](../../../src/infrastructure/queue/worker-runtime/worker-health.server.ts) (worker).

**API quick curl (default port 3000):**

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/live
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/ready
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/worker
```

**Design note:** Throughput staleness (`WORKER_HEALTH_STALL_TIMEOUT_MS`) returns **503** on the **worker** `GET /health/live` only. The API `GET /health/worker` reports dependency connectivity and Redis queue heartbeats; it does **not** 503 when workers stop processing (API `/health/ready` can stay **200** while deps are up).

---

## `GET /health/live`

Cheapest probe: confirms the Node process accepts HTTP. Never touches Postgres or Redis.

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/live
```

| HTTP | Body |
| ---- | ---- |
| 200 | `{ "status": "ok" }` |

**Kubernetes (API):**

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  periodSeconds: 10
  failureThreshold: 3
```

**Railway:** use `/health/live` for the API service liveness check.

During graceful shutdown, `/health/live` stays **200** until the process exits (readiness drains first).

---

## `GET /health/ready`

Readiness: dependency connectivity (1.5s timeout per probe) plus cached operational metrics (60s TTL).

**Dependencies checked:** Postgres (`SELECT 1`), Redis (`PING`), BullMQ broker (queue client ping).

**Operational fields (cached):**

| Field | Meaning |
| ----- | ------- |
| `migration_version` | Latest filename in `public.schema_migrations` |
| `mail_outbox_pending` | Rows in `mail_outbox` with `status = pending` |
| `dlq_depth` | Waiting + failed jobs across monitored DLQ queues |
| `draining` | `true` while the API is shutting down |
| `worker_queues` | Per-queue `last_job_at` from Redis (`worker:queue:<name>:last_job_at`) |

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/ready
```

Response **200** when dependencies are healthy:

```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "bullmq": "connected",
  "latencyMs": { "database": 2, "redis": 1, "bullmq": 3 },
  "migration_version": "20260530000002_user_data_exports.sql",
  "mail_outbox_pending": 0,
  "dlq_depth": 0,
  "draining": false,
  "worker_queues": [
    { "queue": "mail", "last_job_at": "2026-05-20T12:00:00.000Z" }
  ]
}
```

| HTTP | When |
| ---- | ---- |
| 200 | All dependencies connected |
| 503 | Any dependency unavailable (`status: "error"`) |
| 503 | Graceful shutdown (`status: "draining"`) |

While draining, `/health/ready` returns **503** with dependency fields set to `"unavailable"` and **does not** include operational metrics (`migration_version`, `mail_outbox_pending`, etc.).

**Kubernetes (API):**

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  periodSeconds: 10
  failureThreshold: 2
```

**Railway / CI deploy smoke:** poll `GET /health/ready` until HTTP 200 (see [cicd-and-deployment.md](../../deployment/ci-cd/cicd-and-deployment.md)).

### Draining

On `SIGTERM`/`SIGINT`, the API sets a draining flag before `app.close()`. `/health/ready` returns **503** with `status: "draining"` so load balancers stop new traffic while in-flight requests finish. `/health/live` remains **200** until exit. Align platform grace with `SHUTDOWN_TIMEOUT_MS` (default 30s) — [resource-limits.md](../../deployment/runbooks/resource-limits.md).

---

## `GET /health`

Aggregate for operators: `live: ok` plus the same dependency fields as readiness (without operational metrics). **Not** for orchestrators — use `/health/live` and `/health/ready` instead.

Deprecated: responses include `Deprecation: true` and `Sunset` (aggregate sunset **2026-08-19**).

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health
# Deprecation: true, Sunset: 2026-08-19T00:00:00.000Z
curl -sS -D - http://localhost:3000/health | jq .
```

Response **200** when dependencies are connected:

```json
{
  "status": "ok",
  "live": "ok",
  "database": "connected",
  "redis": "connected",
  "bullmq": "connected",
  "latencyMs": { "database": 2, "redis": 1, "bullmq": 3 }
}
```

| HTTP | When |
| ---- | ---- |
| 200 | Dependencies connected |
| 503 | Dependency failure or draining (same rules as readiness for deps) |

---

## `GET /health/worker` (API process)

Dependency view **from the API process**: Postgres, Redis, BullMQ, and `worker_queues` heartbeats. This does **not** prove a worker replica is running or processing jobs — probe the worker HTTP server for that.

Deprecated on the API (same `Deprecation` / `Sunset` as `GET /health`).

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health/worker
curl -sS -D - http://localhost:3000/health/worker | jq .
```

Response **200** when API can reach worker dependencies:

```json
{
  "status": "ok",
  "role": "api",
  "note": "Validates worker dependencies from the API process. For worker replica liveness, probe WORKER_HEALTH_PORT/health/worker on the worker service.",
  "database": "connected",
  "redis": "connected",
  "bullmq": "connected",
  "latencyMs": { "database": 2, "redis": 1, "bullmq": 3 },
  "worker_queues": [
    { "queue": "mail", "last_job_at": "2026-05-20T12:00:00.000Z" },
    { "queue": "webhook-delivery", "last_job_at": null }
  ]
}
```

| HTTP | When |
| ---- | ---- |
| 200 | Dependencies connected from API |
| 503 | Any dependency unavailable |

**Stall detection:** throughput staleness (`WORKER_HEALTH_STALL_TIMEOUT_MS`, default 5 minutes) is enforced on the **worker** `GET /health/live`, not on this API route. After stopping workers, expect API `/health/ready` to stay **200** while worker `/health/live` eventually returns **503** with `status: "stalled"`.

Post-deploy gate: `pnpm tool:worker-readiness` calls **worker** `GET /health/worker` (see below).

---

## Worker HTTP server (`WORKER_HEALTH_PORT`)

The worker process (`pnpm dev:worker`) listens on `WORKER_HEALTH_PORT` (default **9090**, env `HOST` bind). Endpoints:

| Route | Purpose |
| ----- | ------- |
| `GET /health/live` | Worker process up + throughput heartbeats not stalled |
| `GET /health/worker` | Worker readiness: deps + `workersRegistered` + `worker_queues` |
| `GET /health` | Aggregate liveness + deps for the worker process |
| `GET /metrics` | Prometheus scrape when `METRICS_ENABLED=true` (bearer token in production) |

### `GET /metrics` (Prometheus)

When `METRICS_ENABLED=true`, returns Prometheus text format. API: same host as the app. Worker: `WORKER_HEALTH_PORT` (default **9090**). See [observability runbook](../../deployment/runbooks/observability.md).

| Metric | Labels | Purpose |
| ------ | ------ | ------- |
| `event_loop_lag_ms` | — | Event-loop delay p99 (milliseconds) |
| `pg_pool_active`, `pg_pool_idle`, `pg_pool_waiting` | — | Postgres connection counts (from `pg_stat_activity`) |
| `http_request_duration_seconds` | `method`, `route`, `status_code` | Request latency histogram |
| `bullmq_jobs_waiting` | `queue` | Jobs waiting per BullMQ queue |

### `GET /health/live` (worker)

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:9090/health/live
```

| HTTP | Body (examples) |
| ---- | ---------------- |
| 200 | `{ "status": "ok", "service": "worker" }` |
| 503 | `{ "status": "starting", "service": "worker" }` — workers not registered yet |
| 503 | `{ "status": "stalled", "service": "worker" }` — all throughput queue heartbeats older than `WORKER_HEALTH_STALL_TIMEOUT_MS` (default **300000** ms) |

Throughput queues: `mail`, `webhook-delivery`, `notification`, `stripe-webhook`.

**Docker worker HEALTHCHECK:** [`worker-health.ts`](../../../src/scripts/admin/worker-health.ts) probes this URL.

### `GET /health/worker` (worker)

```bash
curl -sS http://127.0.0.1:9090/health/worker | jq .
```

```json
{
  "status": "ok",
  "role": "worker",
  "workersRegistered": 12,
  "database": "connected",
  "redis": "connected",
  "bullmq": "connected",
  "latencyMs": { "database": 1, "redis": 1, "bullmq": 2 },
  "worker_queues": [
    { "queue": "mail", "last_job_at": "2026-05-20T12:05:00.000Z" }
  ]
}
```

Returns **503** when workers are not ready or a dependency is down.

**Post-deploy:**

```bash
WORKER_HEALTH_URL=http://127.0.0.1:9090 pnpm tool:worker-readiness
```

### `GET /health` (worker)

```bash
curl -sS http://127.0.0.1:9090/health | jq .
```

Aggregate for the worker process (liveness + dependency connectivity).

---

## Probe matrix (quick reference)

| Scenario | `/health/live` (API) | `/health/ready` (API) | `/health/live` (worker) |
| -------- | -------------------- | --------------------- | ----------------------- |
| Healthy stack | 200 | 200 | 200 |
| API draining | 200 | 503 `draining` | — |
| Postgres down | 200 | 503 | 503 (worker deps) |
| Workers stopped 6+ min | 200 | 200 (deps up) | 503 `stalled` (after stall timeout) |
| Migration behind | 200 | 200 + old `migration_version` | — |

---

## Environment variables

| Variable | Default | Used by |
| -------- | ------- | ------- |
| `WORKER_HEALTH_PORT` | `9090` | Worker HTTP health + metrics |
| `WORKER_HEALTH_STALL_TIMEOUT_MS` | `300000` (5 min) | Worker `/health/live` stall detection |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | API drain window (align with LB grace) |

See [`.env.example`](../../../.env.example) and [`env-schema.ts`](../../../src/shared/config/env.config.ts).

---

## Related

- Deploy gates: [cicd-and-deployment.md](../../deployment/ci-cd/cicd-and-deployment.md)
- Observability overview: [observability.md](../../deployment/runbooks/observability.md)
- Worker bootstrap and heartbeats: [workers-and-events.md](../runtime/workers-and-events.md)
- Manual API checklist: [api-testing.md](../../getting-started/api-testing.md)
