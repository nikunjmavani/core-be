# Chaos testing (fault injection)

core-be validates graceful degradation paths (permission-cache misses, mail enqueue swallowing,
Stripe circuit breaker local snapshots, readiness probes, BullMQ webhook retries, idempotency
replay) against **live Postgres + Redis**, with failures injected by
[Shopify Toxiproxy](https://github.com/Shopify/toxiproxy).

## When to run locally

1. Start infra and the proxy:
   - `docker compose up -d postgres redis`
   - `pnpm chaos:up` (or `docker compose --profile chaos up -d toxiproxy`)
2. Point the **API process** at proxied ports (**not** the defaults in `.env` unless you override):
   - `DATABASE_URL=postgresql://core:core@127.0.0.1:25432/core`
   - `REDIS_URL=redis://127.0.0.1:26379`
   - `TOXIPROXY_URL=http://127.0.0.1:8474` (administration API for scripts)
3. Register listeners (idempotent):
   - `pnpm chaos:provision`
4. Migrate + run the focused suite:
   - `pnpm db:migrate`
   - `pnpm test:chaos`

`docker-compose.yml` pins `ghcr.io/shopify/toxiproxy` on profile `chaos` and publishes ports
`8474` (admin API), `25432` (Postgres proxy), `26379` (Redis proxy).

## Continuous integration

The **CI / Chaos** job in [`.github/workflows/pr-branch-ci.yml`](../../../.github/workflows/pr-branch-ci.yml) (post-merge on `main` only):

- Runs after **Quality** alongside the main test job.
- Executes `pnpm chaos:provision`, `pnpm db:migrate` against proxied `DATABASE_URL`, then `pnpm test:chaos`.

Upstream addresses inside the proxy container default to `postgres:5432` and `redis:6379`; override
through `CHAOS_TOXIPROXY_POSTGRES_UPSTREAM` / `CHAOS_TOXIPROXY_REDIS_UPSTREAM` only when your Docker
network differs.

## Adding a new chaos scenario

1. Create `src/tests/chaos/<scenario>.chaos.test.ts` so Vitest only picks chaos files from the
   dedicated config (`tooling/vitest/chaos.config.ts`).
2. Prefer **`withTemporaryListeningProxyToxinForChaosAssertion`** helpers in
   [`src/tests/chaos/helpers/toxiproxy.client.ts`](../../../src/tests/chaos/helpers/toxiproxy.client.ts)
   so toxics are cleared between scenarios.
3. Extend [`src/tests/chaos/setup.ts`](../../../src/tests/chaos/setup.ts) hooks only when every
   chaos test needs the behavior (global database cleanup + `/reset` already run there).
4. Avoid importing production modules before `bootstrap-env` finishes — Vitest runs
   `bootstrap-env.ts` ahead of every chaos file to pin proxy URLs.

```mermaid
flowchart LR
  Vitest[Vitest chaos_suite]
  Api[Fastify_via_buildApp]
  ToxicAdmin[Toxiproxy_admin_8474]
  PgListen[Listener_25432_to_postgres]
  RedisListen[Listener_26379_to_redis]
  Pg[(Postgres_container)]
  Redis[(Redis_container)]

  Vitest --> ToxicAdmin
  Vitest --> Api
  Api --> PgListen --> Pg
  Api --> RedisListen --> Redis
```

## Log signals to watch

| Area                    | Log message (Pino)                                   |
| ----------------------- | ---------------------------------------------------- |
| Permission cache        | `permission-cache.get.failed`                        |
| Mail enqueue            | `mail.enqueue.failed`                                |
| Idempotency cache       | `idempotency.cache.*.failed`                         |
| Idempotency cardinality | `idempotency.cache.cardinality.high` / `.critical`   |
| Circuit breaker Redis   | `circuit-breaker.redis.(get\|set).failed`            |
| Webhook delivery worker | `webhook.delivery.completed` / BullMQ retry counters |

## Commands summary

| Command                | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm chaos:up`        | Starts the Toxiproxy container (compose profile `chaos`).          |
| `pnpm chaos:down`      | Stops Toxiproxy (`docker compose --profile chaos stop toxiproxy`). |
| `pnpm chaos:provision` | Registers listener proxies via the administration API.             |
| `pnpm test:chaos`      | Executes `tooling/vitest/chaos.config.ts`.                         |
