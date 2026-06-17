---
name: chaos-test-maintainer
description: Maintains Toxiproxy chaos tests under src/tests/chaos/. Use when adding fault-injection scenarios or changing chaos CI/provision scripts.
---

# Chaos test maintainer (core-be)

Keeps **Toxiproxy** fault-injection tests and provision scripts aligned. See `docs/reference/reliability/chaos-testing.md`.

## When to use

- Added/changed `src/tests/chaos/**/*.chaos.test.ts`
- Changed `tooling/vitest/chaos.config.ts`, `pnpm chaos:provision`, or `docker-compose.yml` chaos profile
- CI job **CI / Chaos** fails

## Local workflow

```bash
docker compose up -d postgres redis   # Docker daemon must be running (docker info)
pnpm chaos:up                         # builds tooling/chaos/toxiproxy.Dockerfile on first run
pnpm chaos:provision                  # default upstreams postgres:5432 / redis:6379 (compose net)
pnpm db:migrate
pnpm test:chaos                        # self-contained: forces NODE_ENV=test, sets proxied URLs itself
```

Proxied defaults: Postgres `25432`, Redis `26379`, Toxiproxy admin `8474`.

## First-run gotchas (read before debugging a "broken" suite)

Most chaos "failures" on a fresh machine are environment, not code. Check these first:

- **Toxiproxy image is built locally, not pulled.** `docker-compose.yml` builds
  [`tooling/chaos/toxiproxy.Dockerfile`](../../../tooling/chaos/toxiproxy.Dockerfile) from the official
  GitHub release binary because `ghcr.io/shopify/toxiproxy`'s blob CDN (`pkg-containers.githubusercontent.com`)
  is 403-blocked on some networks. Don't "fix" `chaos:up` by switching to `image: ghcr.io/...` or Docker Hub
  `shopify/toxiproxy` (Docker Hub only has ≤2.1.4, whose `/version` is a bare string and breaks the health
  check). Keep the pinned version matching the CI service container in `reusable-chaos-toxiproxy.yml`.
- **The suite must run as `NODE_ENV=test`.** `src/tests/chaos/bootstrap-env.ts` hard-forces it (`= 'test'`,
  not `||=`) so a developer's `.env.local` (which `load-env-files` layers as an override, often `NODE_ENV=local`)
  cannot leak through. If it runs as `local`: public auth forms 401 (captcha is only bypassed for
  `test`/`development`/`staging`) and `cleanupDatabase`/`cleanupTestRedis` throw. Never downgrade that to `||=`.
- **Provision upstreams are in-network defaults.** With Toxiproxy in the compose network, `chaos:provision`
  uses `postgres:5432` / `redis:6379`. Only set `CHAOS_TOXIPROXY_POSTGRES_UPSTREAM` / `..._REDIS_UPSTREAM`
  (e.g. `127.0.0.1:5432`) if you run Toxiproxy outside the compose network.
- **Idempotency replay tests must resend the *same* body.** The middleware fingerprint is method+route+**body**;
  a different payload under the same `X-Idempotency-Key` is a correct **422** (`idempotency_key_reuse`), not a replay.
- **Teardown that disables a proxy must bound `app.close()`.** Administratively disabling the Postgres proxy can
  leave a severed `postgres.js` connection that `sql.end()` cannot drain, hanging `afterAll` to its timeout.
  Re-enable the proxy, probe once, then `Promise.race` the close against a short cap (see `postgres-health.chaos.test.ts`).

## Adding a scenario

1. Create `src/tests/chaos/<name>.chaos.test.ts` (picked up only by `tooling/vitest/chaos.config.ts`).
2. Use existing helpers for toxic injection and cleanup.
3. Assert **graceful degradation** (no unhandled rejections; correct HTTP/status/cache behavior).
4. Document non-obvious setup in `docs/reference/reliability/chaos-testing.md` if needed.

## CI

`reusable-chaos-toxiproxy.yml`: provision → migrate (proxied `DATABASE_URL`) → `pnpm test:chaos`.

## Checklist

- [ ] Scenario cleans up toxics after test (and bounds `app.close()` if it disables a proxy)
- [ ] Does not rely on RLS session context in workers (pass organization identifiers explicitly)
- [ ] `pnpm test:chaos` passes locally with chaos profile up
- [ ] No changes to default `pnpm test` unless intentional
- [ ] `bootstrap-env.ts` still hard-forces `NODE_ENV = 'test'` (never `||=`)
- [ ] Toxiproxy still built locally from `tooling/chaos/toxiproxy.Dockerfile`, version matching the CI service container

## Related skills

- **workers-events** — queue/worker behavior under faults
- **production-hardening-guard** — circuit breakers, readiness
- **ci-investigator** — chaos job failures
