# Exhaustive Hardening Roadmap — "Push the Bar Higher"

> Status: **approved design / roadmap**
> Date: 2026-06-02
> Goal: take core-be from its current top-tier baseline to an *exhaustive,
> maximally-rigorous* quality posture, with every guarantee enforced by a gate so
> it cannot drift. Execution model: PR-by-PR, auto-merge on green (same cadence as
> the robustness/concurrency sweep that produced #292–#305).

This is a **decomposed roadmap**: one spec that sequences 11 workstreams (H1–H11).
Each workstream gets its own implementation plan and ships as one or a few PRs.

---

## 1. Why this is a *ratchet*, not a *build*

A measured audit (not estimates) shows core-be has **independently built ~60–70%
of the original 9-PR plan and three of the four "push higher" pillars already**.
The honest, highest-confidence move is to **ratchet existing gates and close named
gaps**, not rebuild infrastructure.

### Confidence scorecard (measured 2026-06-02)

| Dimension | Measured today | Gated today? | Ceiling | Real gap |
|---|---|---|---|---|
| Lines / statements | ~93% / ~93% (floor 90/90) | ✅ merged unit+db gate | ~95% | small |
| Functions | ~96% (floor 94) | ✅ | ~97% | tiny |
| **Branches** | **~84%** (floor 80) | ✅ | ~90% | **main coverage gap** |
| Patch coverage (changed code) | 90% on diff | ✅ PR gate | — | done |
| **Route HTTP behavior matrix** | validator exists (403 + 400/422 tiers) | ❌ **not wired** | wired + blocking + green | **clearest enforcement gap** |
| **Mutation (Stryker)** | `break:70` kill-rate on auth/billing/tenancy services + all security middlewares | ✅ weekly | `break:80`, wider scope, PR-incremental | ratchet + speed |
| Load / SLO (k6) | 25 scenarios; daily gate on health-stress + api-stress | ✅ daily | gate more critical paths | expand gate |
| Chaos (Toxiproxy) | 13 tests | ✅ weekly | named outage cases | expand |
| Security suites | 53 (auth, SSRF, injection, BOLA, leakage, races…) | ✅ in CI | verify named cases | spot-fill |
| DR / backup | restore-smoke (weekly) + restore-RTO (monthly) | ✅ scheduled | — | already strong |
| Property tests | 7 | ✅ ci:quality | every DTO | expand |
| Contract tests | 7 (Stripe / Resend / S3) | ✅ ci:quality | every external call | expand |
| Test files total | 620 (425 unit, 74 integration, 53 security, 13 chaos, 10 e2e, 7 property, 7 contract) | — | — | broad |

**Headline: already ~90% of the way to "world's best" on every axis.** The remaining
~10% is specific and finite.

### Already built (do **not** rebuild)

- Coverage: merged unit+db measurement, floor 90/90/94/80, **patch-coverage PR gate**.
- `validate-route-http-coverage.ts` + util + allowlist + its own unit test — encodes
  Tier-D (403 forbidden) and Tier-E (400/422 validation) rules. **Not yet wired.**
- Stryker mutation: `stryker.config.json` (`break:70`), `test:mutation`, vitest runner,
  **`scheduled-stryker-mutation.yml`** (weekly + dispatch, artifact upload).
- Nightly quality workflows: `scheduled-k6-load-slo.yml` (daily SLO gate on health-stress
  - api-stress), `scheduled-chaos.yml` (weekly), `scheduled-weekly-restore-smoke.yml`,
  `scheduled-monthly-restore-rto.yml`.
- 25 k6 scenarios; 13 chaos tests; 53 security suites; 10 vitest projects
  (unit, unit-db, property, global, integration, e2e, security, performance, smoke, chaos, contract).
- Node 24 required (`engines: ">=24"`).
- Static gates: CodeQL, Trivy image scan, gitleaks, semgrep, deps audit (+prod), action-pin check,
  oasdiff breaking-change, domain-structure, route catalog, tsdoc budget, locale parity.

### Current route-validator output (the authoritative gap list)

Running the existing validator today, the **entire** route-coverage gap is:

- **`mcp`** — missing 403 (forbidden) coverage.
- **`ops`** — missing 400/422 validation coverage + route-literal test signal
  (`GET /internal/ops/circuit-breakers`, `POST …/:circuitName/reset`).

Everything else across all 131 routes already has HTTP test signal.

---

## 2. Principles

- **Ratchet-in-place.** Every threshold tightens to *just above current actual*, then
  climbs over subsequent PRs. Never a CI-breaking big-bang. (Matches the repo's existing
  "thresholds only go up" + patch-coverage philosophy.)
- **Tool-driven, not guessed.** The route validator and Stryker *emit* the exact finite
  gap list (missing route assertions; surviving mutants). We fill *those*, not a guessed
  "hundreds of tests." This is more rigorous and bounded.
- **Every guarantee is a gate.** A property only counts if CI fails when it regresses.
- **Honesty over padding.** Where a thing is already solid, we verify and move on — we do
  not author redundant tests to inflate counts.
- **Red/green every fix.** Each behavioral fix is proven by reverting it (bug reproduces)
  and restoring (test passes), as in #292–#305.

---

## 3. The 11 workstreams (H1–H11)

Mapped to the user's original PR1–PR9. Effort is rough relative size.

### H1 — Wire the route-HTTP-coverage gate (orig PR1) · **S**

- **Delta:** add `validate:route-http-coverage` script; run it **blocking** in `pr-ci.yml`
  and in `ci:quality`/`ci:local`. Close the two real gaps: **mcp** 403 test, **ops** 400/422 + route-literal tests.
- **Acceptance:** `pnpm validate:route-http-coverage` exits 0; CI fails if a new route lacks
  HTTP signal, a guarded domain lacks 403, or a mutating domain lacks 400/422.
- *Highest confidence-per-effort: a built gate that currently does not enforce.*

### H2 — Every-route behavior matrix, validator-driven (orig PR2) · **L**

- **Delta:** extend the validator tiers beyond exists/403/400-422 to require, per route class:
  success, 401 (missing/malformed/expired token), 403 (role + org-permission), 400/422
  (unknown keys + bad types), pagination (limit/cursor/invalid-cursor/empty/tenant-filter) for
  list routes, and idempotency-replay for idempotent mutations. The validator emits an exact
  finite checklist; fill only what it flags.
- **Acceptance:** validator green at the new tier; each focus domain (auth, tenancy, billing,
  notify, user, upload, audit, ops, mcp, metrics, health) passes its required matrix cells.

### H3 — Mutation-guided validator/serializer/DTO edge + leakage (orig PR3) · **M**

- **Delta:** expand Stryker `mutate` scope to `*.serializer.ts`, `*.validator.ts`, `*.dto.ts`,
  and high-risk repos/utils. Surviving mutants *name* the exact missing assertions; add those.
  Plus a serializer-leakage property: no response serializes secret/hash/internal-id/deleted rows.
- **Acceptance:** Stryker kill-rate ≥ break on the widened scope; leakage property test green.

### H4 — Access-control + injection + idempotency/concurrency confirmation (orig PR4–6) · **M**

- **Delta:** *mostly already delivered this session* — JWT/role/key attacks, tenant isolation
  (HTTP + worker RLS), injection/upload/SSRF, idempotency scoping + fingerprint, and **four
  concurrency races fixed (#302–#305)**. This workstream is a **confirmation pass**: assert each
  named case from PR4–6 maps to an existing suite; spot-fill the genuinely-missing few; add the
  remaining concurrency cases (concurrent subscription create, concurrent API-key rotation).
- **Acceptance:** a checklist doc maps every PR4–6 case → test file; no unmapped case; new
  spot-fills red/green verified.

### H5 — Expand nightly load + chaos SLO gates (orig PR7–8) · **M**

- **Delta (load):** promote informational scenarios to **SLO-gated**: login-storm, permission
  cached-read, permission write, notification write, idempotency-storm, RLS-concurrency-beyond-pool.
  Add explicit SLOs (read p95 < 500ms, health p95 < 200ms, failure < 1%, sensitive routes 429 under abuse).
- **Delta (chaos):** add named outage cases — Redis down during permission-cache read; Redis down
  during idempotency read/write; BullMQ enqueue failure; Postgres latency/reset toxic; **DB pool
  exhaustion**; webhook DLQ; circuit-breaker open/half-open/recovery. Assert graceful degradation
  (clean 503, no hang/500) + the expected observability signal.
- **Acceptance:** the new scenarios SLO-gate in `scheduled-k6-load-slo.yml`; chaos cases assert
  degradation + log/Sentry signal in `scheduled-chaos.yml`.

### H6 — Ratchet + production-readiness scorecard (orig PR9) · **S**

- **Delta:** branch floor 80 → **84 now**, with a climb plan toward ~88; Stryker `break` 70 → **80**
  - wider `mutate`; **PR-incremental mutation** on changed files (fast) layered over the nightly full run;
  a living `docs/reference/quality/production-readiness.md` scorecard with every gate, its current
  value, target, and a table of **intentionally allowlisted gaps with owner + expiry date**.
- **Acceptance:** `ci:quality`/`ci:local` green at the new floors; PR-incremental mutation job runs;
  scorecard doc committed and referenced from CLAUDE.md.

### H7 — Property/fuzz tests on every DTO (exhaustive) · **M**

- **Delta:** extend the `property` project from 7 suites to **cover every `*.dto.ts`** with
  fast-check generators — fuzz unknown keys, Unicode, control chars, boundary numbers, malformed
  IDs/cursors/dates/enums; assert the validator never throws an *un-typed* error (always a typed
  `ValidationError`, never a 500).
- **Acceptance:** a meta-test asserts every DTO has a corresponding property suite; all green.

### H8 — Contract tests for every external dependency (exhaustive) · **M**

- **Delta:** extend `contract` from 7 to cover **every outbound call** to Stripe, Resend, S3
  (and any other external) — request shape, success, every documented error, signature/idempotency
  semantics, timeout/retry. Pin against recorded fixtures so a provider-SDK upgrade that changes the
  contract fails CI.
- **Acceptance:** a coverage check maps every external-client method → a contract test; all green in `ci:quality`.

### H9 — SLO error-budget tracking (exhaustive) · **M**

- **Delta:** beyond pass/fail SLO, compute and persist an **error budget** per critical SLO from the
  nightly k6 JSON artifacts (burn-rate over a rolling window); a workflow step fails when budget burn
  exceeds policy, and writes a trend artifact. Optional: surface as a Sentry/metrics dashboard panel.
- **Acceptance:** nightly job emits an error-budget JSON + fails on policy breach; documented in the scorecard.

### H10 — Supply-chain / SBOM gates (exhaustive) · **S–M**

- **Delta:** generate an **SBOM** (CycloneDX) per build; add an OSV/grype scan layered over the existing
  `deps:audit` + Trivy; verify dependency provenance; keep the existing action-pin check. Gate on new
  critical/high vulnerabilities and on un-pinned/unsigned artifacts.
- **Acceptance:** SBOM artifact attached to build; supply-chain scan blocks on new critical/high; documented.

### H11 — DAST (dynamic app security testing) (exhaustive) · **M–L**

- **Delta:** a scheduled workflow boots the app + seed, runs an **OWASP ZAP baseline (passive) scan**
  (and a tuned active scan on a safe subset) against the running API, with an allowlist for known
  non-issues. Complements the static CodeQL/semgrep with runtime findings (headers, TLS, auth flows).
- **Acceptance:** scheduled DAST workflow green with a triaged allowlist; new findings block or file an issue.

---

## 4. Sequencing

Order by **confidence-per-effort** and dependency:

1. **H1** (wire route gate; close mcp/ops) — fastest enforcement win, unblocks H2.
2. **H6 (partial)** — branch floor 80→84 + Stryker break 70→80 immediately (already-passing ratchet),
   establishing the climb; PR-incremental mutation wiring.
3. **H4** — confirmation pass + concurrency spot-fills (mostly done; cheap, high assurance).
4. **H2** — every-route matrix (largest test-authoring; validator-bounded).
5. **H3** — mutation-guided edge/leakage (depends on widened Stryker scope from H6).
6. **H7**, **H8** — property-every-DTO, contract-every-dep (parallelizable).
7. **H5** — expand load + chaos SLO gates.
8. **H9** — error-budget tracking (depends on H5's expanded scenarios).
9. **H10**, **H11** — supply-chain/SBOM, DAST (independent; can run anytime).
10. **H6 (final)** — climb branch floor toward ~88, finalize scorecard, lock all gates blocking.

Each step is one (or a few) PRs, verified and auto-merged on green before the next.

## 5. Definition of done (initiative)

- Every workstream's acceptance gate is **enforced in CI** (PR-blocking or nightly-gating).
- `docs/reference/quality/production-readiness.md` lists every gate, current value, target, and
  every intentionally-allowlisted gap with **owner + expiry**.
- No guarantee relies on a human remembering to run something.
- The confidence scorecard is reproducible from `pnpm` scripts.

## 6. Risks & mitigations

- **Branch coverage past ~88 / mutation past ~85 → diminishing returns / brittle tests.** Mitigate
  with the ratchet (stop where value flattens) and the allowlist-with-expiry, not a blanket target.
- **PR-incremental mutation latency.** Scope to changed files + `--since`; keep the full run nightly.
- **DAST flakiness / false positives.** Passive baseline first; tuned active scan on a safe subset;
  triaged allowlist.
- **Nightly cost.** Schedule spread across days; artifacts retained with retention limits.

## 7. Out of scope (intentional)

- Rewriting existing passing tests for style.
- Chasing 100% line/branch coverage (negative-value past ~90; see `test-coverage.md`).
- Non-quality feature work.
