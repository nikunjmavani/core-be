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
docker compose up -d postgres redis
pnpm chaos:up
pnpm chaos:provision
# Point API/worker at proxied ports (see docs/reference/reliability/chaos-testing.md)
pnpm db:migrate
pnpm test:chaos
```

Proxied defaults: Postgres `25432`, Redis `26379`, Toxiproxy admin `8474`.

## Adding a scenario

1. Create `src/tests/chaos/<name>.chaos.test.ts` (picked up only by `tooling/vitest/chaos.config.ts`).
2. Use existing helpers for toxic injection and cleanup.
3. Assert **graceful degradation** (no unhandled rejections; correct HTTP/status/cache behavior).
4. Document non-obvious setup in `docs/reference/reliability/chaos-testing.md` if needed.

## CI

`reusable/chaos-toxiproxy.yml`: provision → migrate (proxied `DATABASE_URL`) → `pnpm test:chaos`.

## Checklist

- [ ] Scenario cleans up toxics after test
- [ ] Does not rely on RLS session context in workers (pass organization identifiers explicitly)
- [ ] `pnpm test:chaos` passes locally with chaos profile up
- [ ] No changes to default `pnpm test` unless intentional

## Related skills

- **workers-events** — queue/worker behavior under faults
- **production-hardening-guard** — circuit breakers, readiness
- **ci-investigator** — chaos job failures
