# HTTP idempotency

core-be deduplicates mutating HTTP requests when clients send an **`Idempotency-Key`** header.

---

## Behavior

| Aspect | Detail |
| ------ | ------ |
| **Methods** | `POST`, `PUT`, `PATCH`, `DELETE` |
| **Header** | `Idempotency-Key` (validated format; see `parseIdempotencyKeyHeader`) |
| **Scope** | Redis key includes organization and user when present: `idempotency:{org}:{user}:{key}` |
| **TTL** | 24 hours for completed responses; 60s placeholder while in flight |
| **Redis down** | **503** `service_unavailable` (fail closed) |
| **Duplicate while in flight** | **409** `conflict_in_flight` (translation key `errors:idempotencyKeyInFlight`) |
| **Lost SETNX race after miss** | **409** `conflict` (translation key `errors:idempotencyKeyConflict`); replay if the winner has already completed |
| **Duplicate after completion** | Cached response replayed with `x-idempotency-replay: true` |
| **Commit safety** | Completed cache is written in the `onResponse` Fastify hook **only** when `statusCode < 400`, so a rolled-back request never leaves a successful replay entry behind |

Implementation: [`src/shared/middlewares/core/idempotency.middleware.ts`](../../../src/shared/middlewares/core/idempotency.middleware.ts).

### Redis entry shape (state machine)

Two discriminated states are stored under each cache key:

```json
{ "state": "in_flight", "claimedAt": 1700000000000, "requestId": "abcd" }
```

```json
{ "state": "completed", "statusCode": 201, "body": "...", "headers": { "content-type": "application/json" } }
```

Legacy placeholders written before this state machine (no `state` field, or `state` other than `completed`) are treated as `in_flight` during rolling deploys. Clients seeing the `409 conflict_in_flight` response should wait and retry once the original request has completed.

---

## Recommended routes

The header is **optional** on all writes, but **strongly recommended** where duplicate side effects are costly:

| Method | Path | Notes |
| ------ | ---- | ----- |
| `POST` | `/api/v1/billing/subscriptions` | Key forwarded to Stripe `subscriptions.create` when Stripe is configured |

The generated route catalog (`docs/routes.txt`) lists this under **IDEMPOTENCY**. OpenAPI descriptions for subscription create reference this page.

---

## Operations

- Monitor Redis cardinality via the repeatable `idempotency-cardinality` worker ([observability runbook](../../deployment/runbooks/observability.md)).
- Ensure production Redis uses `maxmemory-policy noeviction` so idempotency keys are not evicted early ([runbook-dev-to-production](../../deployment/runbooks/runbook-dev-to-production.md)).

## Related

- [`src/PATTERNS.md`](../../../src/PATTERNS.md) § Idempotency — cross-cutting pattern overview (HTTP layer + Stripe webhook layer)
- [`src/POLICIES.md`](../../../src/POLICIES.md) — `IDEMPOTENCY_*` constants (TTL, in-flight grace window, max key length)
- [`src/shared/middlewares/core/idempotency.middleware.ts`](../../../src/shared/middlewares/core/idempotency.middleware.ts) — middleware implementation
- [`src/shared/utils/idempotency/`](../../../src/shared/utils/idempotency/) — key parser and policy helpers
