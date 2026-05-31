# Health checks

Health endpoints return **raw JSON** with no API response envelope. API and worker services are deployed as separate Railway services, and each service exposes a **liveness** and a **readiness** probe.

Implementation:

- API: [`health.middleware.ts`](../../../src/shared/middlewares/core/health.middleware.ts)
- Worker: [`worker-health.server.ts`](../../../src/infrastructure/queue/worker-runtime/worker-health.server.ts)

The previous combined `GET /health` endpoint has been **removed** and replaced by an explicit split:

| Path | Kind | Dependency probes | Backs |
| ---- | ---- | ----------------- | ----- |
| `GET /livez` | Liveness | None | Container `HEALTHCHECK` — "is the process up" |
| `GET /readyz` | Readiness | Postgres + Redis + BullMQ | Deploy gating + load-balancer routing |

Both endpoints are canonical and **not deprecated**. They do not emit `Deprecation` or `Sunset` headers.

## API `GET /livez`

Liveness verifies the process and event loop are responsive. It runs **no** dependency probes, so it stays cheap and is safe for the container liveness `HEALTHCHECK` — a healthy-but-not-yet-ready process (e.g. dependency warm-up) is not killed.

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/livez
```

Response **200** when the process is responsive:

```json
{ "status": "ok" }
```

| HTTP | When |
| ---- | ---- |
| 200 | Process and event loop responsive |
| 503 | Graceful shutdown (`status: "draining"`) |

## API `GET /readyz`

Readiness validates dependency connectivity and operational signals:

- Postgres (`SELECT 1`)
- Redis (`PING`)
- BullMQ broker connectivity
- Cached operational metrics

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/readyz
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

While draining, `/readyz` returns **503** with dependency fields set to `"unavailable"` and does not include cached operational metrics.

### API Orchestrator Probes

Use `/livez` for the container `HEALTHCHECK` (liveness) and `/readyz` for the readiness/load-balancer probe in Railway, Docker, and Kubernetes. Readiness is intentionally dependency-aware: if Postgres, Redis, or BullMQ are unavailable, `/readyz` returns 503 and the orchestrator stops routing traffic without killing the process.

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 3000
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  periodSeconds: 10
  failureThreshold: 2
```

On `SIGTERM`/`SIGINT`, the API sets a draining flag before `app.close()`. `/readyz` returns **503** with `status: "draining"` so load balancers stop new traffic while in-flight requests finish; `/livez` keeps reporting the process state. Align platform grace with `SHUTDOWN_TIMEOUT_MS` (default 30s) — [resource-limits.md](../../deployment/runbooks/resource-limits.md).

## Worker `GET /livez` and `GET /readyz`

Worker replicas expose `GET /livez` and `GET /readyz` on `WORKER_HEALTH_PORT` (default **9090**).

`/livez` confirms the worker process and its HTTP server are responsive, independent of worker registration, so a still-warming-up worker is not killed:

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:9090/livez
```

```json
{ "status": "live", "role": "worker" }
```

`/readyz` validates the worker process and queue state in addition to dependencies:

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:9090/readyz
```

Response **200** when the worker is ready and dependencies are healthy:

```json
{
  "status": "ok",
  "role": "worker",
  "database": "connected",
  "redis": "connected",
  "bullmq": "connected",
  "latencyMs": { "database": 2, "redis": 1, "bullmq": 3 },
  "workersRegistered": 25,
  "worker_queues": [
    { "queue": "mail", "last_job_at": "2026-05-20T12:00:00.000Z" }
  ]
}
```

| HTTP | Status | When |
| ---- | ------ | ---- |
| 200 | `ok` | Worker marked ready, dependencies connected, throughput not stalled |
| 503 | `starting` | Worker process has not called `markWorkerHealthReady()` |
| 503 | `stalled` | Throughput queue heartbeats are older than `WORKER_HEALTH_STALL_TIMEOUT_MS` |
| 503 | `error` | Any dependency unavailable |

## Metrics

The worker HTTP server also exposes `GET /metrics` when metrics are enabled. In production, metrics require a valid bearer token when `METRICS_ENABLED=true` and `METRICS_SCRAPE_TOKEN` is configured.

```bash
curl -H "Authorization: Bearer $METRICS_SCRAPE_TOKEN" http://localhost:9090/metrics
```

## Deploy Probes

[`reusable-railway-deploy.yml`](../../../.github/workflows/reusable-railway-deploy.yml) deploys the API and worker from scanned GHCR images, syncs shared Railway variables to both services, then probes:

- API service: `GET /readyz` on the API public domain.
- Worker service: deployment terminal SUCCESS only. Railway only flips a worker deployment to SUCCESS once the in-pod container `HEALTHCHECK` in `Dockerfile.worker` (which hits `127.0.0.1:9090/readyz` inside the pod and exercises Postgres, Redis, BullMQ, queue heartbeats) starts returning 200. CI cannot probe the worker further: the worker service has no public Railway domain, and Postgres/Redis sit on the Railway private network (`*.railway.internal`) which is unreachable from GitHub Actions runners. The post-deploy API smoke run additionally exercises paths whose side effects flow through the worker fleet, and DLQ growth is alerted via Sentry from inside the worker.
- Deployed API smoke: `pnpm test:api-smoke` against the Railway API base URL (after API readiness passes). Uses `SMOKE_DEMO_EMAIL` / `SMOKE_DEMO_PASSWORD` GitHub Environment secrets when set; otherwise defaults to the full-seed demo user (`demo@example.com`). Ensure the target environment database is seeded accordingly.

**Fully live:** When this smoke step succeeds, CD completes and the GitHub Environment (development or production) is considered fully live for traffic. Earlier probes only confirm process and dependency connectivity; smoke validates real HTTP routes end-to-end on the deployed URL.

## Local Checks

```bash
# API liveness
curl -sS http://localhost:3000/livez | jq .

# API readiness
curl -sS http://localhost:3000/readyz | jq .

# Worker (redis-direct: DLQ + heartbeats + dependency probes via Redis/Postgres).
# Local dev or `railway run` only — the GitHub Actions runner cannot reach
# `*.railway.internal`, so this script is no longer invoked from CI.
pnpm tool:worker-readiness

# Worker (HTTP fallback against a locally exposed worker /readyz endpoint).
WORKER_HEALTH_URL=http://127.0.0.1:9090 pnpm tool:worker-readiness
```

Related docs:

- [CI/CD and deployment](../../deployment/ci-cd/cicd-and-deployment.md)
- [Resource limits](../../deployment/runbooks/resource-limits.md)
- [Observability](../../deployment/runbooks/observability.md)
