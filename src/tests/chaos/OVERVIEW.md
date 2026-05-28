`src/tests/chaos/`

# Chaos / fault-injection tests

## Purpose

Toxiproxy-driven fault-injection tests. Each test introduces a controlled failure (Postgres latency, Redis disconnect, packet loss) and asserts that the platform's resilience primitives — circuit breakers, retries, idempotency, transactional outbox — behave correctly under stress.

Vitest config: [tooling/vitest/chaos.config.ts](tooling/vitest/chaos.config.ts).

What this suite covers:

- Postgres latency injection → query timeouts, statement-timeout pathing, pool waiter alerts.
- Redis disconnect → BullMQ stall + recovery, permission cache fallback, idempotency middleware behavior.
- Outbound HTTP slowness → circuit breaker open / half-open / close transitions.
- Combined-failure scenarios (Postgres slow + Redis flapping).

What it does **not** cover: HTTP behavior under happy path (integration suite), latency / SLO measurement (load suite).

## Test types

- **Per-resource chaos** — one Toxiproxy listener per resource, multiple toxic injections per test.
- **Cross-resource chaos** — combined faults that exercise the platform end-to-end.

## How to run

```bash
pnpm chaos:up && pnpm chaos:provision   # start Toxiproxy + register listeners
pnpm test:chaos                          # run the suite
pnpm chaos:down                          # tear down
```

## Fixtures and helpers

- `chaos.constants.ts` — toxic profile names + thresholds.
- `bootstrap-env.ts` — overrides DATABASE_URL / REDIS_URL to point at the Toxiproxy listeners.
- `provision-proxies.ts` — registers the listener configurations on every chaos run.

## Dependencies

- **Toxiproxy sidecar** (`docker compose --profile chaos up`).
- **Postgres + Redis** behind Toxiproxy (the proxies mediate every connection).

## Failure modes

- **Toxic injected but the test never observes the expected behavior** → likely the platform connected to the real port instead of the listener; check `bootstrap-env.ts` overrides.
- **Stuck job after chaos run** → BullMQ retains the failed job; clean with `pnpm chaos:cleanup` (when present) or restart Redis.

## Related docs

- [docs/reference/reliability/chaos-testing.md](docs/reference/reliability/chaos-testing.md)
