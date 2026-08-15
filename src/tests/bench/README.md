# Microbenchmarks (`run-benches.ts`)

Autocannon-driven endpoint benchmark runner (spawns `npx autocannon --json`). Not run by Vitest — needs a live `pnpm dev` server; authed rows use the seeded demo user.

```bash
pnpm test:bench                 # full matrix (readyz, public plans, users/me, permission-cached memberships)
pnpm test:bench:quick           # readyz only, 5s
pnpm test:bench --only users-me --duration 30
```

For deployed load testing use k6 under `src/tests/load/k6/`.
