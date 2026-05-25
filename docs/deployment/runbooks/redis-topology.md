# Redis topology (single shared instance)

core-be uses **two Redis surfaces**:

| Surface | Env | Workloads |
| ------- | --- | --------- |
| **Cache** | `REDIS_URL` | Permission cache, idempotency, rate limits, OAuth/MFA/WebAuthn state, circuit breakers |
| **BullMQ** | `REDIS_URL` by default | Mail, notifications, webhooks, Stripe webhook, retention workers, DLQ |

**Current topology:** all Redis-backed workloads intentionally share one managed Redis instance for development and production. `REDIS_BULLMQ_URL` remains an optional override, but production validation expects it to be unset or point at the same endpoint as `REDIS_URL`.

---

## Memory pool caveat

On a **single physical Redis instance**, OOM, eviction, restart, or `FLUSHALL` affects cache and queue workloads together.

| Failure mode | Cache workload impact | BullMQ workload impact |
| ------------ | ------------------- | --------------------------- |
| OOM / eviction | Permission cache cold; idempotency keys evicted | Queued jobs lost or stalled |
| Restart without persistence | Cold cache | Job data may be lost |
| Provider incident | Cache workloads down | Queue workloads down |

Mitigation for the current single-instance topology: use a plan with enough memory headroom, enable provider persistence when available, alert on memory usage, and keep DLQ/retry visibility healthy.

---

## Environment variables

| Variable | Role | Default |
| -------- | ---- | ------- |
| `REDIS_URL` | Cache, rate limits, idempotency, OAuth state, permission cache, circuit-breaker state | required |
| `REDIS_BULLMQ_URL` | Optional BullMQ override | unset; BullMQ uses `REDIS_URL` |
| `REDIS_KEY_PREFIX` | Key prefix for cache + BullMQ on shared clusters | `core:<NODE_ENV>:` (e.g. `core:production:`) |

Set `REDIS_KEY_PREFIX` when multiple environments share one Redis instance to avoid queue/cache cross-pollination. BullMQ `prefix` and ioredis `keyPrefix` both use [`resolveRedisKeyPrefix()`](../../../src/infrastructure/cache/redis-prefix.util.ts).

Boot validation in every runtime:

- `REDIS_BULLMQ_URL` may be omitted.
- If set, it must point to the same Redis endpoint as `REDIS_URL` for the current single-instance deployment.

---

### Local / Docker Compose

Single Redis container; no logical DB split is required:

```text
REDIS_URL=redis://localhost:6379
# Optional only if you need to override BullMQ explicitly:
# REDIS_BULLMQ_URL=redis://localhost:6379
```

A startup **warning** is logged when BullMQ is configured to use a separate Redis host.

---

### Production

1. Create **one Upstash Redis database** (or equivalent managed Redis) for the environment.
2. Set `REDIS_URL` in GitHub Environment secrets (via `pnpm setup:infra` → `UPSTASH_REDIS_URL`, or manually).
3. Leave `REDIS_BULLMQ_URL` unset. If an older environment already has it, remove it or set it to the exact same endpoint as `REDIS_URL`.
4. Enable persistence when the provider supports it, since queues and cache share the same instance.

#### Blast radius

| Instance down | User-visible impact | Mitigation |
| ------------- | ------------------- | ---------- |
| Shared Redis | Higher Postgres load from cache misses; idempotency may allow duplicate writes on client retry; emails, webhooks, retention jobs, and exports stall | Restore Redis; workers resume; inspect DLQs; permissions repopulate on read |

---

## Readiness

`GET /health` pings Redis and performs a representative BullMQ queue probe. If `REDIS_BULLMQ_URL` is explicitly configured to a different endpoint, readiness also pings that dedicated BullMQ Redis client.

---

## Production rollout checklist

Complete **before** deploying the single-instance topology:

1. Confirm one managed Redis instance exists per environment and `REDIS_URL` points to it.
2. Remove `REDIS_BULLMQ_URL` from GitHub `development` and `production` environment secrets, or set it equal to `REDIS_URL` during transition.
3. Rolling restart API and worker services so the shared URL is loaded.
4. Verify `GET /health` — `redis` and `bullmq` should be `connected`.
5. **Job migration:** queued jobs on a previous separate BullMQ Redis instance are **not** copied automatically. Drain workers or accept a brief maintenance window before cutover.

---

## Disaster recovery

When rotating Redis credentials or failing over, update **`REDIS_URL`** on API and worker services. Remove or mirror `REDIS_BULLMQ_URL` if it exists from an older split topology. See [dr-runbook.md](../../process/dr-runbook.md).

---

## Related

- [resource-limits.md](resource-limits.md) — Postgres pool budget
- [external-service-resilience.md](../../reference/reliability/external-service-resilience.md) — circuit breakers (Redis-backed on cache Redis)
- [setup-automation.md](../setup/setup-automation.md) — `UPSTASH_REDIS_URL` in `.env.setup`
