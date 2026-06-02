# Test coverage policy

How coverage is **scoped**, **measured**, and **gated** in core-be — and the
prioritized plan for tightening it. Read this before changing
`tooling/ci/coverage-thresholds.json` or the coverage CI jobs.

## Scope — what is measured

Coverage is deliberately scoped to the **core business-logic surface**, not the
whole tree. From `vitest.config.ts`:

```text
include:  src/domains/**/*.service.ts
          src/domains/**/*.repository.ts
          src/domains/**/*.controller.ts
          src/shared/**/*.ts
exclude:  src/tests/**, src/scripts/**, src/domains/**/__tests__/**, *.d.ts
```

So validators, serializers, schemas, DTOs, workers, queues, events, seeds, and
all of `src/infrastructure/**` are **outside** the coverage denominator. They
are still tested (see `docs`/`CLAUDE.md` testing sections) — they just do not
count toward the coverage percentage. This keeps the metric focused on the code
where an untested path is most likely to be an expensive bug.

## Baseline — actual coverage (measured surface)

True merged coverage (pure-unit **plus** integration/e2e/security), computed by
merging both shard reports through
`tooling/ci/merge-coverage-and-check-thresholds.mjs`:

| Metric     | Coverage | Gate threshold |
| ---------- | -------- | -------------- |
| Lines      | ~93%     | 80%            |
| Statements | ~93%     | 80%            |
| Functions  | ~96%     | 80%            |
| Branches   | ~84%     | 70%            |

The codebase already sits **well above** the configured thresholds. The
thresholds are conservative floors, not the real bar.

> Do not read a single shard's report as "the coverage." The pure-unit shard
> alone is ~80% lines; the integration/e2e/security shard alone is ~70%; their
> **merge** is ~93%. Always merge before judging.

## How it is measured and gated

Two lanes run tests, split for speed:

- **PR lane** (`reusable-vitest-unit-only.yml`) — pure unit/property/global
  only, for fast PR feedback. **Runs no coverage.**
- **Post-merge lane** (`reusable-vitest-postgres-redis.yml`) — the DB-bound
  matrix (integration, e2e, security, unit-db, performance) with coverage,
  sharded by domain. The `Coverage` job downloads the shard artifacts, merges
  them, and checks thresholds.

The merged gate is **`--report-only` on `dev`** (prints the result, never
fails the build) and **blocking** when the target branch is not `dev` (the
`dev → main` release path).

### Known gap: CI measures only the DB-bound shards

The post-merge `Coverage` job sees only the DB-bound matrix artifacts — the
**pure-unit project is never run with coverage in CI**. So CI's merged number
reflects ~70% (DB-bound in isolation), not the true ~93%. Locally,
`pnpm test:coverage` runs **both** lanes and reports the true merged number.

This is why the thresholds cannot simply be ratcheted today: CI cannot yet
verify the real coverage, so raising the floor above ~70% would block the
`main` release gate even though the codebase is at ~93%. **Fixing the
measurement is the prerequisite for tightening the floor** (see follow-ups).

## Patch (differential) coverage — `pnpm coverage:patch`

Beyond the global floor, new code is held to a higher bar via
`tooling/ci/check-patch-coverage.mjs`: it measures the line coverage of the
lines a change **added or modified** (against a base ref), over the same
measured surface, and enforces a stricter threshold (default **90%**).

```bash
# 1. produce a full local merged report
pnpm test:coverage            # writes coverage/coverage-final.json

# 2. check the coverage of your branch's changes vs the base
pnpm coverage:patch                       # base defaults to origin/dev
PATCH_COVERAGE_BASE=origin/main pnpm coverage:patch
```

The script only counts **executable** changed lines (a line with an
instrumented statement) in **in-scope** files — changes to validators, schemas,
tests, infra, etc. neither help nor hurt the number, keeping it honest and in
lock step with the global coverage scope. It is unit-tested in
`src/tests/unit/tooling/check-patch-coverage.unit.test.ts`.

Why patch coverage is the high-leverage lever: the global floor moves slowly and
says nothing about a specific change. Patch coverage holds **every** PR's delta
to a high standard, so new code stays well-tested without a costly retro-fit of
the whole tree — and it cannot regress.

## Why not a blanket 90% / 95% global gate

The four metrics do not cost the same to raise, and the bug-detection value of
the last few percent is low:

- **Lines / statements / functions** to ~90% is reasonable — usually real
  untested paths.
- **Branches** is where it gets expensive: pushing past ~85% means testing
  defensive guards, `?? fallback` arms, and circuit-breaker-open paths that are
  often correct by construction and costly to trigger.
- **95% (especially branches)** reliably produces negative value — it forces
  tests on trivial code and incentivizes gaming (deleting defensive code, or
  assertion-free tests that execute lines without verifying behavior). The
  highest-value test work is targeted (e.g. a fail-closed 503 path), which a
  coverage number never points you to.

Prefer: **patch coverage on new code** + a **ratchet** of the global floor to
just under the true number + (optionally) **per-area floors** on the
security-critical domains — over a blanket 90/95.

## Prioritized follow-ups

1. **Measure the true merge in CI.** Add a unit-coverage job to the post-merge
   lane that runs `--project unit --project property --project global` with
   coverage and uploads a `coverage-unit` artifact. The `Coverage` job already
   downloads `coverage-*` and will merge it automatically — making CI's number
   the true ~93%.
2. **Ratchet the floor (after #1).** With CI measuring truly, raise
   `tooling/ci/coverage-thresholds.json` to just under the real numbers, e.g.
   `lines 90, statements 90, functions 95, branches 80`. Keep branches
   conservative.
3. **Make patch coverage a blocking PR check (after #1).** Run
   `pnpm coverage:patch` against the merged report on PRs and fail under 90% on
   new code. This needs the merged report available on the PR lane (depends on
   #1's artifact wiring).
4. **Per-area floors (optional).** Extend
   `merge-coverage-and-check-thresholds.mjs` to enforce stricter per-directory
   floors (e.g. 90%) on `src/domains/auth`, `src/domains/billing`, and
   `src/domains/tenancy/sub-domains/permission` — coverage highest where a bug
   is most expensive.

Items 2–4 depend on item 1: **measurement before enforcement.**
