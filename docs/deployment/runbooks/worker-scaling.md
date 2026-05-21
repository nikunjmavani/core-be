# Worker scaling runbook

BullMQ workers run as a **separate process** (`node dist/worker.js` / `Dockerfile.worker`). Scale workers independently of the API.

---

## When to scale out

| Signal | Action |
| ------ | ------ |
| Queue depth growing steadily | Add worker replicas (same `REDIS_URL`, `DATABASE_URL`) |
| Job latency p95 above SLO | Scale workers or tune `WORKER_CONCURRENCY` per queue |
| CPU pegged on worker container | Horizontal scale before raising per-process concurrency |
| DLQ depth alerts | Fix root cause first; see [bull-board.md](../../reference/runtime/bull-board.md) |

---

## Railway / container notes

- Deploy **API** (`Dockerfile` `api` target) and **worker** (`Dockerfile.worker`) as separate services.
- Worker image has **no HTTP health endpoint** — rely on process exit/restart and queue metrics ([docker-images.md](../docker-images.md)).
- Use the same secrets as the API for `DATABASE_URL`, `REDIS_URL`, Stripe, mail, and Sentry.

---

## Safe scaling practices

1. **One logical queue name per job type** — do not shard the same queue across incompatible processors.
2. **Pass `organizationPublicId` in tenant-scoped job payloads** — workers set `app.current_organization_id` via `withOrganizationContext` / `runTenantScopedWorkerJob`, not HTTP middleware. Unpinned DB access in the worker process throws `WorkerDatabaseContextError` at runtime.
3. **System tables without tenant RLS** (`auth.mail_outbox`, `billing.stripe_webhook_events`) — use `withSystemTableWorkerContext` in processors; see [workers-and-events.md](../../reference/runtime/workers-and-events.md).
4. **Redis key prefix** — parallel agents or environments must use distinct `REDIS` namespaces to avoid queue collisions.
5. **Graceful shutdown** — workers honor SIGTERM; allow drain time before force-kill during deploys.

---

## Related

- [workers-and-events.md](../../reference/runtime/workers-and-events.md)
- [observability.md](observability.md)
- [resource-limits.md](resource-limits.md)
