# Health checks

Health endpoints return **raw JSON** with no API response envelope. API and worker services are deployed as separate Railway services, and each service exposes its own `GET /health` endpoint.

Implementation:

- API: [`health.middleware.ts`](../../../src/shared/middlewares/health.middleware.ts)
- Worker: [`worker-health.server.ts`](../../../src/infrastructure/queue/worker-runtime/worker-health.server.ts)

`GET /health` is canonical and is **not deprecated**. It does not emit `Deprecation` or `Sunset` headers.

## API `GET /health`

The API health endpoint is readiness-style. It validates dependency connectivity and operational signals:

- Postgres (`SELECT 1`)
- Redis (`PING`)
- BullMQ broker connectivity
- Cached operational metrics

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/health
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

While draining, `/health` returns **503** with dependency fields set to `"unavailable"` and does not include cached operational metrics.

### API Orchestrator Probe

Use `/health` for the API service health check in Railway, Docker, and Kubernetes. This is intentionally readiness-style: if Postgres, Redis, or BullMQ are unavailable, the endpoint returns 503.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  periodSeconds: 10
  failureThreshold: 2
```

On `SIGTERM`/`SIGINT`, the API sets a draining flag before `app.close()`. `/health` returns **503** with `status: "draining"` so load balancers stop new traffic while in-flight requests finish. Align platform grace with `SHUTDOWN_TIMEOUT_MS` (default 30s) — [resource-limits.md](../../deployment/runbooks/resource-limits.md).

## Worker `GET /health`

Worker replicas expose `GET /health` on `WORKER_HEALTH_PORT` (default **9090**). This endpoint validates the worker process and queue state in addition to dependencies.

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:9090/health
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

- API service: `GET /health` on the API public domain.
- Worker service: deployment terminal SUCCESS only. Railway only flips a worker deployment to SUCCESS once the in-pod container HEALTHCHECK in `Dockerfile.worker` (which hits `127.0.0.1:9090/health` inside the pod and exercises Postgres, Redis, BullMQ, queue heartbeats) starts returning 200. CI cannot probe the worker further: the worker service has no public Railway domain, and Postgres/Redis sit on the Railway private network (`*.railway.internal`) which is unreachable from GitHub Actions runners. The post-deploy API smoke run additionally exercises paths whose side effects flow through the worker fleet, and DLQ growth is alerted via Sentry from inside the worker.
- Deployed API smoke: `pnpm test:api-smoke` against the Railway API base URL (after API health passes). Uses `SMOKE_DEMO_EMAIL` / `SMOKE_DEMO_PASSWORD` GitHub Environment secrets when set; otherwise defaults to the full-seed demo user (`demo@example.com`). Ensure the target environment database is seeded accordingly.

**Fully live:** When this smoke step succeeds, CD completes and the GitHub Environment (development or production) is considered fully live for traffic. Earlier probes only confirm process and dependency connectivity; smoke validates real HTTP routes end-to-end on the deployed URL.

## Local Checks

```bash
# API
curl -sS http://localhost:3000/health | jq .

# Worker (redis-direct: DLQ + heartbeats + dependency probes via Redis/Postgres).
# Local dev or `railway run` only — the GitHub Actions runner cannot reach
# `*.railway.internal`, so this script is no longer invoked from CI.
pnpm tool:worker-readiness

# Worker (HTTP fallback against a locally exposed worker /health endpoint).
WORKER_HEALTH_URL=http://127.0.0.1:9090 pnpm tool:worker-readiness
```

Related docs:

- [CI/CD and deployment](../../deployment/ci-cd/cicd-and-deployment.md)
- [Resource limits](../../deployment/runbooks/resource-limits.md)
- [Observability](../../deployment/runbooks/observability.md)
