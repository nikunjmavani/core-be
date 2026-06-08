# Re-Audit Remediation — Design Spec

**Date:** 2026-06-06
**Owner:** Nikunj Mavani (with Claude Opus 4.7)
**Source:** Re-audit report covering the 35 sec-* fixes shipped across PRs #444–#450
**Status:** Approved for implementation pending user sign-off on this spec

---

## 1. Background

A 35-fix security remediation campaign (PRs #444–#450) was followed by a 7-lane parallel re-audit
on 2026-06-06. The re-audit verified 22 of the 35 fixes as clean but surfaced **18 open findings**
(1 Critical, 3 High, 6 Medium, 8 Low). Of those, 15 are regressions or sibling-misses in the
just-shipped fixes; 3 are pre-existing issues the first audit missed.

The two most damaging failure modes the re-audit caught:

- **sec-CM #26 BREACH fix is a no-op** — the suppression hook sets a response header, but
  `@fastify/compress` reads the inbound request header. The fix never engages in production.
- **sec-D #10 notification worker user-context fix is dead code** — the worker wiring still
  injects the retention-GUC repository, which short-circuits the new flow. The runtime is
  unchanged from before PR #450.

Both were detectable by tracing the production wiring path against the diff. Neither was caught
by the existing test suite because the tests mock the very path that's broken.

## 2. Goals

1. Land all 18 fixes against `dev` via 18 individual PRs (one finding per PR).
2. Add a regression test for each Critical/High finding (PRs #01–#04) so the production wiring
   path is exercised — not just the unit-test-friendly path.
3. Pass `pnpm ci:local` on every PR.
4. **Zero regressions to existing functionality.**

## 3. Non-goals

- No refactors or abstractions beyond what each finding requires.
- No squash-amends; each PR is one commit.
- No `--no-verify` pushes; pre-commit hooks must pass.
- No mass test coverage expansion — only targeted regression tests where the fix is at risk of
  not engaging in production.
- No changes to fixes already shipped that the re-audit verified clean.

## 4. Approach

### 4.1 Batching: one PR per finding (18 PRs)

User-selected. Highest review granularity and easiest revert path. Trade-off accepted: 18× the
CI cost, manageable rebase burden (only one pair of fixes touches the same method).

### 4.2 Branch naming

`fix/sec-re-<NN>-<short-slug>`

Two-digit `NN` matches the severity order (see §5) and sorts lexically.

### 4.3 PR title and commit message

`fix(sec): <description> (sec-re-NN)`

Matches the existing `fix(sec): … (sec-* batch)` style from PRs #444-#450.

### 4.4 PR body template

```markdown
## Summary
- <one-line description of the bug>
- <one-line description of the fix>
- Re-audit Finding #NN (severity <Critical/High/Medium/Low>)

## Test plan
- [ ] Regression test added (Critical/High only)
- [ ] pnpm typecheck
- [ ] pnpm lint
- [ ] pnpm test:unit
- [ ] pnpm ci:local (Critical/High only)
- [ ] Sibling-site grep performed
```

### 4.5 Co-author

Every commit includes:

```text
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## 5. Order (severity-first, dependency-aware)

| # | Sev | Slug | Primary files | Dependency |
|---|---|---|---|---|
| 01 | CRIT | `d10-wiring` | `notification.worker.ts`, worker-repo factory | — |
| 02 | HIGH | `stripe-reclaim-handoff` | `stripe-webhook-event.repository.ts`, `stripe-webhook.service.ts` | — |
| 03 | HIGH | `breach-compression` | `compress.middleware.ts` | — |
| 04 | HIGH | `mfa-reenroll-dedup` | `auth-mfa.service.ts`, `auth-method.repository.ts`, new migration | — |
| 05 | MED  | `sec-a9-revoked-replay` | `auth.service.ts` | — |
| 06 | MED  | `mfa-flip-in-txn` | `auth-mfa.service.ts` | **Rebase after #04** |
| 07 | MED  | `subscription-plan-public-id` | `subscription.repository.ts`, `subscription.serializer.ts` | — |
| 08 | MED  | `audit-serializer-strip` | `audit.serializer.ts` | — |
| 09 | MED  | `test-webhook-empty-secret` | `webhook.service.ts` | — |
| 10 | MED  | `upload-copy-toctou` | `upload.service.ts`, `s3-adapter.ts` | — |
| 11 | MED  | `rate-limit-email-hash` | `rate-limit-presets.constants.ts` | — |
| 12 | LOW  | `data-export-doc` | `user.routes.ts` | — |
| 13 | LOW  | `mark-confirmed-filter` | `upload.repository.ts` | — |
| 14 | LOW  | `recovery-code-alphabet-doc` | `auth-mfa-recovery-code.util.ts` | — |
| 15 | LOW  | `stripe-timeout-honesty` | `stripe.client.ts` | — |
| 16 | LOW  | `org-context-statement-timeout` | `tenant-database.context.ts` | — |
| 17 | LOW  | `cors-client-request-id` | `cors.middleware.ts` | — |
| 18 | LOW  | `path-param-validation` | `membership.controller.ts`, `organization-api-key.controller.ts` | — |

Only one same-file rebase: PR-06 follows PR-04 because both touch `enrollConfirm`.

## 6. Per-PR workflow

### 6.1 Critical/High (PRs #01–#04) — TDD discipline

1. `git checkout dev && git pull origin dev`
2. `git checkout -b fix/sec-re-<NN>-<slug>`
3. Write a failing test that demonstrates the bug in current `dev`
4. Run the test — **confirm it fails for the right reason** (not e.g. import error)
5. Apply the fix
6. Run the test — confirm it passes
7. Run pre-push double-check gate (§7)
8. `git add -p` + `git commit` (HEREDOC message)
9. `git push -u origin fix/sec-re-<NN>-<slug>`
10. `gh pr create --base dev` with the body template

### 6.2 Medium/Low (PRs #05–#18) — light validation

1. Branch off dev (steps 1–2 above)
2. Apply fix
3. Run `pnpm typecheck` + `pnpm lint` + `pnpm test:unit`
4. Run pre-push double-check gate (§7)
5. Commit, push, open PR

## 7. Pre-push double-check gate (every PR)

Hard rule before any `git push`:

```text
[ ] 1.  Re-read the original re-audit finding (file:line + recommended fix)
[ ] 2.  Run `git diff dev...HEAD --stat` and re-read every changed line
[ ] 3.  Verify the diff actually fixes the bug (no adjacent-but-wrong fix)
[ ] 4.  Verify the new regression test (if any) fails on dev and passes on this branch
[ ] 5.  pnpm typecheck — must pass
[ ] 6.  pnpm lint — must pass
[ ] 7.  pnpm test:unit — must pass
[ ] 8.  Critical/High only: pnpm test (full suite) — must pass
[ ] 9.  Critical/High only: trace the production wiring path and prove the new code is reachable
[ ] 10. Sibling-site sweep — grep the codebase for the same anti-pattern elsewhere
[ ] 11. Migration review (if any): no blocking DDL, IF NOT EXISTS, CONCURRENTLY where required
[ ] 12. Re-read the commit message — accurate, references sec-re-NN
```

Steps 9 and 10 were added because of the sec-CM #26 (BREACH) and sec-D #10 (worker wiring)
failure modes from the original audit. The first audit's tests didn't catch them; making the
trace and the grep an explicit named gate ensures the same class doesn't ship again.

## 8. Critical-fix execution detail

### 8.1 PR-01 — sec-D10 wiring (CRITICAL)

**Files**

- `src/domains/notify/sub-domains/notification/workers/notification.worker.ts`
- `src/domains/notify/sub-domains/notification/workers/notification.worker.repository.factory.ts` (or wherever `createWorkerNotificationRepository` lives)

**Fix**

1. In `notification.worker.ts:269-277`, drop the `runGlobalRetentionWorkerJob` wrapper and the
   `createWorkerNotificationRepository(databaseHandle)` argument for the tenant-less branch.
   Let `processNotificationDispatchJob` enter its own `loadNotificationForScope` flow.
2. In `createWorkerNotificationRepository`, update the `assertWorkerDatabaseContext` allow-list
   to include `'global_admin'` and `'user'` so the new flow's database contexts are accepted.

**Regression test**

- Mock `processNotificationDispatchJob` to capture its arguments. Enqueue a notification job
  with `organizationPublicId === null`. Assert:
  - The 4th argument (notificationRepository) is `undefined`, NOT a repository instance.
  - `runGlobalRetentionWorkerJob` is NOT called.
  - `loadNotificationForScope` IS called (test against a mock or a real DB stub).

**Production-wiring assertion**

- Add an `expect(runGlobalRetentionWorkerJob).not.toHaveBeenCalled()` in the test.

### 8.2 PR-02 — Stripe reclaim cron → worker handoff (HIGH)

**Files**

- `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.ts`
- `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.ts`

**Fix**

1. Add a new repository method `findReclaimableStripeEventIds(batchSize)` that SELECTs ids
   matching the same WHERE as the current `tryReclaimEvent` — but does NOT update.
2. Refactor `sweepReclaimableEvents` to use `findReclaimableStripeEventIds` and enqueue without
   mutating the row. Drop the `tryReclaimEvent` call from the sweep path.
3. The worker's `tryClaimEvent` already calls `tryReclaimEvent` and will perform the transition
   itself — no worker-side change needed.

**Regression test**

- Simulate the failure scenario:
  1. Pre-claim a row in the HTTP path (status=processing, attempt_count=0).
  2. Simulate Redis outage: HTTP enqueue fails after the commit.
  3. Run the cron sweep.
  4. Trigger the worker dequeue.
  5. Assert the row transitions to `processed` (not stuck in `processing`).

### 8.3 PR-03 — BREACH compression-skip (HIGH)

**Files**

- `src/shared/middlewares/core/compress.middleware.ts`

**Fix**

- Replace `reply.header('x-no-compression', '1')` and `reply.removeHeader('content-encoding')`
  with `reply.header('Content-Encoding', 'identity-no-compress')`. `@fastify/compress` checks
  `responseEncoding && responseEncoding !== 'identity'` and short-circuits.

**Regression test**

- Register a test route that returns a payload matching `responseBodyContainsSecretFields`.
- Inject a request with `accept-encoding: gzip`.
- Assert response `Content-Encoding === 'identity-no-compress'`.
- Assert response body is NOT gzipped (first two bytes are not `0x1f 0x8b`).

### 8.4 PR-04 — MFA re-enroll soft-lockout (HIGH)

**Files**

- `src/domains/auth/sub-domains/auth-mfa/auth-mfa.service.ts`
- `src/domains/auth/sub-domains/auth-method/auth-method.repository.ts`
- `migrations/<timestamp>_auth_methods_mfa_totp_partial_unique.sql` (NEW)

**Fix**

1. Inside the `enrollConfirm` `withUserDatabaseContext` callback:
   - Call `authMethodService.listMfaMethodsByUserId(user.id)`.
   - For each existing TOTP method, call `authMethodService.revokeAuthMethod(method.id, user.id)`.
   - Call `invalidateAllUnusedRecoveryCodesForUser(user.id)`.
   - THEN insert the new method + recovery codes.
2. Add `ORDER BY revoked_at DESC NULLS FIRST, id DESC` to `findTotpByUserId` so login always
   picks the most recent active row.
3. New migration: `CREATE UNIQUE INDEX CONCURRENTLY uniq_auth_methods_user_active_totp
   ON auth.auth_methods (user_id) WHERE method_type = 'MFA_TOTP' AND revoked_at IS NULL;`

**Regression test**

- enrollInit → enrollConfirm with TOTP code A → verify success
- enrollInit again → enrollConfirm with TOTP code B → verify success
- Query auth_methods directly: assert exactly ONE active MFA_TOTP row for the user.
- Login attempt with B → succeeds. Login attempt with A → rejected.
- Recovery code from the first enrollment → rejected. Recovery code from the second → accepted.

## 9. Same-file rebase plan

PR-06 (`mfa-flip-in-txn`) needs PR-04 to land first because both touch `enrollConfirm`. Plan:

1. Open and merge PR-04.
2. Rebase PR-06 branch on the new `dev`.
3. Push the rebased branch.

I will NOT open PR-06 in parallel with PR-04. PR-14 (recovery-code-alphabet-doc) touches a
different file in the same domain — no rebase needed; can be opened in any order.

## 10. Risk assessment per PR

| PR | Risk | Mitigation |
|---|---|---|
| 01 | High blast radius (all notifications) | TDD + production-wiring assertion + sibling-site grep |
| 02 | High blast radius (all Stripe webhooks) | TDD + 5-min Redis outage scenario in test |
| 03 | High blast radius (all HTTP responses) | TDD + binary-bytes inspection; sentinel encoding stays non-default |
| 04 | Moderate (only MFA users) | Migration uses `CREATE UNIQUE INDEX CONCURRENTLY`; backfill is a no-op (each user already has ≤1 active row in practice) |
| 05 | Low (refresh-token path narrow) | Unit test on the new code path |
| 06 | Low (same surface as #04) | Rebase + re-run #04's test suite |
| 07-09 | Low | Existing test suite + shape tests |
| 10 | Low (TOCTOU window narrow; bucket headers reject) | Add `CopySourceIfMatch`; no behavior change on happy path |
| 11 | Low (logging-only) | Hash-shape assertion in test |
| 12-18 | Very low (mostly doc/config) | Lint + typecheck |

## 11. Open questions

None — all key decisions resolved during brainstorming:

- Batching = one PR per finding (user-confirmed)
- Order = severity-first, dependency-aware (user-confirmed)
- Tests = TDD for Critical/High, existing suite for Medium/Low (user-confirmed)
- Push gate = pre-push double-check checklist (added at user emphasis)

## 12. Definition of done

- All 18 PRs are open against `dev`.
- Each PR includes a green CI run (GitHub Actions).
- Each Critical/High PR includes a regression test that fails on `dev` and passes on the branch.
- The PR body for each links to the corresponding re-audit Finding #NN with the file:line cited
  in the re-audit report.
- No `--no-verify` was used.
- No regression to any of the 22 already-clean sec-* fixes (verified by `pnpm test` on each PR).

---

**Next step (per brainstorming skill):** user reviews this spec, then I invoke the writing-plans
skill to produce a step-by-step implementation plan, then execution begins.
