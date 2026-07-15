# Redis topology (isolated cache and BullMQ surfaces)

core-be uses **two Redis surfaces**:

| Surface | Env | Workloads |
| ------- | --- | --------- |
| **Cache (write-critical)** | `REDIS_URL` | Permission cache, idempotency, rate limits, OAuth/MFA/WebAuthn state, circuit breakers |
| **BullMQ (queue)** | `REDIS_BULLMQ_URL`, falling back to `REDIS_URL` | Mail, notifications, webhooks, Stripe webhook, retention workers, DLQ |

**Recommended topology:** run BullMQ on a **dedicated** Redis instance (`REDIS_BULLMQ_URL`) in production, separate from the write-critical cache/idempotency/rate-limit store on `REDIS_URL`. A worker outage lets the BullMQ waiting queue grow until Redis fills; with `maxmemory-policy=noeviction` a full instance rejects all writes. Isolating queues means a queue backlog **cannot** starve idempotency/rate-limit writes and turn a worker problem into an API write outage.

**Local/dev fallback:** when `REDIS_BULLMQ_URL` is unset, BullMQ shares `REDIS_URL`, keeping local development and CI single-instance with no extra service to run.

---

## Memory pool caveat

When cache and BullMQ **share one instance** (local, or production before isolation), OOM, eviction, restart, or `FLUSHALL` affects both workloads together — and a queue backlog can exhaust the memory the write-critical store needs.

| Failure mode | Cache workload impact | BullMQ workload impact |
| ------------ | ------------------- | --------------------------- |
| OOM / eviction | Permission cache cold; idempotency keys evicted; **writes rejected under `noeviction`** | Queued jobs lost or stalled |
| Restart without persistence | Cold cache | Job data may be lost |
| Provider incident | Cache workloads down | Queue workloads down |

Isolating BullMQ onto `REDIS_BULLMQ_URL` removes the cross-workload blast radius: a queue backlog can only fill the queue instance, leaving idempotency and rate-limit writes healthy on the cache instance.

---

## Saturation alerting

The [dlq-depth worker](../../../src/infrastructure/observability/dlq-depth/dlq-depth.worker.ts) samples two leading indicators on its existing schedule (alongside DLQ depth) via [`redis-saturation.service.ts`](../../../src/infrastructure/observability/redis-saturation/redis-saturation.service.ts):

- **Redis memory saturation** — reads `used_memory` (`INFO memory`) and `maxmemory` (`CONFIG GET maxmemory`) and computes the ratio. Crossing `REDIS_MEMORY_WARN_RATIO` logs a warning; crossing `REDIS_MEMORY_CRITICAL_RATIO` escalates to Sentry. This is the early-warning signal for the `noeviction` write-outage failure mode.
- **BullMQ waiting depth** — sums `waiting` + `delayed` jobs across source queues. Crossing `QUEUE_WAITING_DEPTH_WARN_THRESHOLD` warns (and escalates to Sentry), surfacing a worker outage *before* the backlog fills Redis.

Wire these logs/Sentry events to the on-call alerting channel. See [observability.md](observability.md) for the alert catalogue.

---

## High availability recommendation (ops)

For production, prefer a managed Redis offering with a **replica + automatic failover** (e.g. Redis primary/replica with a sentinel or the provider's HA plan) for both surfaces, and enable **persistence** (AOF or RDB) so an instance restart does not drop queued jobs or cold the cache. HA is an infrastructure/provider concern (not enforced in code); the code-level guard is the saturation alerting above plus the cache/queue isolation. Document the chosen plan in the environment's infra notes.

---

## Environment variables

| Variable | Role | Default |
| -------- | ---- | ------- |
| `REDIS_URL` | Cache, rate limits, idempotency, OAuth state, permission cache, circuit-breaker state | required |
| `REDIS_BULLMQ_URL` | Dedicated BullMQ endpoint (recommended in production). Falls back to `REDIS_URL` when unset | unset; BullMQ uses `REDIS_URL` |
| `REDIS_KEY_PREFIX` | Key prefix for cache + BullMQ on shared clusters | `core:<NODE_ENV>:` (e.g. `core:production:`) |
| `REDIS_MEMORY_WARN_RATIO` | `used_memory/maxmemory` ratio that logs a warning | `0.8` |
| `REDIS_MEMORY_CRITICAL_RATIO` | `used_memory/maxmemory` ratio that escalates to Sentry (must be ≥ warn) | `0.9` |
| `QUEUE_WAITING_DEPTH_WARN_THRESHOLD` | BullMQ `waiting`+`delayed` depth that warns/escalates | `1000` |

Set `REDIS_KEY_PREFIX` when multiple environments share one Redis instance to avoid queue/cache cross-pollination. BullMQ `prefix` and ioredis `keyPrefix` both use [`resolveRedisKeyPrefix()`](../../../src/infrastructure/cache/redis-prefix.util.ts).

Boot validation in every runtime:

- `REDIS_BULLMQ_URL` may be omitted (BullMQ then shares `REDIS_URL`).
- If set, it must be a parseable `redis://` / `rediss://` URL. A different host or logical database is fully supported and recommended.

---

### Local / Docker Compose

Single Redis container; no logical DB split is required:

```text
REDIS_URL=redis://localhost:6379
# Optional: point BullMQ at a separate local instance / logical DB to mirror prod isolation:
# REDIS_BULLMQ_URL=redis://localhost:6380
```

A startup **info** log records whether BullMQ is sharing `REDIS_URL` or using a dedicated endpoint.

---

### Production

1. Create **two Railway Redis database services** per environment (cache + BullMQ) from Railway's `redis` template, or one HA instance per surface.
2. Set `REDIS_URL` (cache) and `REDIS_BULLMQ_URL` (BullMQ) in GitHub Environment secrets (provisioned externally or set manually).
3. Enable persistence on both, and prefer a replica + automatic failover plan (see HA recommendation above).
4. Configure alerting on the saturation signals (`REDIS_MEMORY_*_RATIO`, `QUEUE_WAITING_DEPTH_WARN_THRESHOLD`).

#### Transport security

`REDIS_URL` intentionally uses the unencrypted `redis://` scheme against Railway's private domain (`*.railway.internal`). Railway's private network is an IPv6 WireGuard mesh — traffic between `api`, `worker`, and `redis` services never leaves Railway's encrypted infrastructure, so application-layer TLS (`rediss://`) is not required for the current topology and is **not** enabled on the Redis container.

A boot assertion ([`assert-redis-tls-safety.ts`](../../../src/infrastructure/cache/assert-redis-tls-safety.ts), run from `server.ts` and `worker.ts`) **fails closed in hosted deployments** when `REDIS_URL` (or a `REDIS_BULLMQ_URL` override) is plaintext `redis://` to a **public** host. Plaintext is allowed only on trusted private/internal networks — `*.railway.internal`, `*.cluster.local`, `*.local`, RFC 1918, and loopback — which keeps the Railway private-mesh topology above valid. Outside hosted deployments (local/CI) the check only warns. When a URL is `rediss://`, ioredis is given an explicit `tls: { rejectUnauthorized: true }` ([`buildRedisTlsOptions`](../../../src/infrastructure/cache/redis-url.parse.util.ts)) so the certificate is verified, not merely encrypted.

If Redis is ever exposed on a public TCP proxy (or moved off the Railway private mesh), enable TLS by:

1. Configuring the Redis service with `--tls-port`, `--tls-cert-file`, and `--tls-key-file` (and dropping `--port`).
2. Mounting a CA cert into API/worker containers via `REDIS_TLS_CA` and switching `tls: {}` in [`getBullMQConnectionOptions`](../../../src/infrastructure/queue/connection.ts) and [`redis.client.ts`](../../../src/infrastructure/cache/redis.client.ts) to `tls: { ca: [REDIS_TLS_CA] }`.
3. Updating `REDIS_URL` (and `REDIS_BULLMQ_URL` if set) to `rediss://` — which also satisfies the boot assertion for public endpoints.

#### Blast radius

| Instance down | User-visible impact | Mitigation |
| ------------- | ------------------- | ---------- |
| Cache (`REDIS_URL`) | Higher Postgres load from cache misses; idempotency may allow duplicate writes on client retry; rate limiter fails open | Restore Redis; permissions repopulate on read |
| BullMQ (`REDIS_BULLMQ_URL`) | Emails, webhooks, retention jobs, and exports stall; **API writes unaffected** | Restore Redis; workers resume; inspect DLQs |
| Shared (single-instance) | Both of the above simultaneously | Restore Redis; isolate surfaces to reduce blast radius |

---

## Readiness

`GET /readyz` pings Redis and performs a representative BullMQ queue probe. If `REDIS_BULLMQ_URL` is explicitly configured to a different endpoint, readiness also pings that dedicated BullMQ Redis client.

---

## Production rollout checklist

Complete **before** cutting over to isolated surfaces:

1. Provision the dedicated BullMQ Redis instance and set `REDIS_BULLMQ_URL` in the GitHub Environment secrets.
2. **Job migration:** queued jobs do **not** copy automatically between instances. Drain workers (or accept a brief maintenance window) before cutover so no in-flight jobs are stranded on the old endpoint.
3. Rolling restart API and worker services so the new URLs load.
4. Verify `GET /readyz` — `redis` and `bullmq` should be `connected`.
5. Confirm saturation alerts are wired (memory ratio + waiting depth).

---

## Disaster recovery

When rotating Redis credentials or failing over, update **`REDIS_URL`** and **`REDIS_BULLMQ_URL`** on API and worker services. See [dr-runbook.md](../../process/dr-runbook.md).

---

## Related

- [resource-limits.md](resource-limits.md) — Postgres pool budget
- [observability.md](observability.md) — saturation + DLQ alert catalogue
- [external-service-resilience.md](../../reference/reliability/external-service-resilience.md) — circuit breakers (Redis-backed on cache Redis)
