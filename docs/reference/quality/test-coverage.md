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
| Lines      | ~93%     | 91%            |
| Statements | ~93%     | 91%            |
| Functions  | ~96%     | 94%            |
| Branches   | ~84%     | 82%            |

The codebase already sits **above** the configured thresholds. The thresholds
are conservative floors that **ratchet upward only** (never down).

**Ratchet history.** Floors started at 90/90/94/80 (lines/statements/functions/branches).
Hardening-roadmap workstream **H6** raised lines/statements 90→91 and branches
80→82 (each still ~2pts below the measured actual, so the merged gate stays
green). The next H6-final step takes a fresh measured run to push branches
toward ~88 and `functions` past 94, alongside raising the Stryker `break`
kill-rate from 70 — both gated on the measurement so a floor never lands above
the real number.

> Do not read a single shard's report as "the coverage." The pure-unit shard
> alone is ~80% lines; the integration/e2e/security shard alone is ~70%; their
> **merge** is ~93%. Always merge before judging.

## How it is measured and gated

Two lanes run tests, split for speed:

- **PR lane** (`reusable-vitest-unit-only.yml`) — pure unit/property/global
  only, for fast PR feedback. **Runs no coverage.**
- **Post-merge lane** (`reusable-vitest-postgres-redis.yml`) — the DB-bound
  matrix (integration, e2e, security, unit-db, performance) with coverage,
  sharded by domain, **plus** a `Unit coverage` job that runs the unit/global
  projects with coverage (no Postgres, mirrors the PR unit lane). The `Coverage`
  job downloads every `coverage-*` shard artifact — DB-bound shards and the
  `coverage-unit` artifact — merges them, and checks thresholds.

The merged gate is **`--report-only` on `dev`** (prints the result, never
fails the build) and **blocking** when the target branch is not `dev` (the
`dev → main` release path).

### CI now measures the true merge

Because the post-merge lane includes the `Unit coverage` job, the `Coverage`
gate merges **unit + DB-bound** and reports the true number (~93% lines), the
same figure `pnpm test:coverage` produces locally. (Before this, CI saw only the
DB-bound shards in isolation — ~70% — because the pure-unit project was never run
with coverage in CI.)

With CI now verifying the real coverage, the global floor can be **ratcheted**
toward the true numbers (see follow-ups) — the prerequisite ("measurement before
enforcement") is satisfied.

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

1. ~~**Measure the true merge in CI.**~~ **Done** — the post-merge lane runs a
   `Unit coverage` job that emits a `coverage-unit` artifact; the `Coverage` gate
   merges it with the DB-bound shards (via the existing `coverage-*` download) so
   CI now reports the true ~93%.
2. ~~**Ratchet the floor.**~~ **Done** — with CI confirming the merged gate at
   93.03% lines / 92.27% statements / 96.11% functions / 83.25% branches, the
   floor in `tooling/ci/coverage-thresholds.json` was raised to
   `lines 90, statements 90, functions 94, branches 80` (a 2–3pt buffer under the
   real numbers so a normal dip does not block the `dev → main` release gate).
3. **Make patch coverage a blocking PR check.** Run `pnpm coverage:patch`
   against the merged report on PRs and fail under 90% on new code. Needs the
   merged report available on the PR lane (the `coverage-unit` artifact wiring
   from #1 is the foundation).
4. **Per-area floors (optional).** Extend
   `merge-coverage-and-check-thresholds.mjs` to enforce stricter per-directory
   floors (e.g. 90%) on `src/domains/auth`, `src/domains/billing`, and
   `src/domains/tenancy/sub-domains/permission` — coverage highest where a bug
   is most expensive.

**Measurement before enforcement** — #1 (done) unblocks #2–4.
