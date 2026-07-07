# Runbook: Hotfix release (single-trunk)

How to ship an urgent fix under the single-`main` delivery model.

Trunk-based: `main` is always releasable, and a hotfix **fixes forward** on `main` — it is just a
`fix:` change you release immediately instead of waiting for the next cadence. There is **no
protected `release/*` branch** and no off-trunk patching.

## The flow (the only flow)

1. Cut a `fix/<slug>` (or `hotfix/<slug>`) branch off `main`, make the fix, open a PR to `main`.
2. CI runs the authoritative gate — the single **`Quality gate`** required check rolls up lint,
   typecheck, unit, the DB **matrix**, security, and the non-superuser RLS suite (plus **`Checks`**).
   When green, **squash-merge** it (0 approvals required — D8).
3. The post-merge run refreshes the **`chore: release X.Y.Z` Release PR**. **Merge that Release PR** —
   that is the ship button: it tags the release, which fires `release-deploy.yml` to deploy production
   (behind the environment reviewer approval), promoting the exact scanned image built for the merge
   (build-once-promote — see [deploy-artifact-and-secret-decisions.md](../ci-cd/deploy-artifact-and-secret-decisions.md)).

That's it — a hotfix is a `fix:` PR you release straight away by merging the Release PR.

## Faster mitigations (prefer these when the fix isn't ready)

- **Rollback** the running image instead of coding a fix: `rollback-deploy.yml` redeploys the
  previous production image (`:previous`) with no rebuild — see [rollback-deploy.md](rollback-deploy.md).
  You can also re-deploy any prior release tag via `release-deploy.yml` → **Run workflow** with the
  tag as input (pinned to that tag's SHA).
- **Feature flags** are usually faster than a code hotfix — flipping a `FEATURE_*` variable is a
  config-only redeploy, no release. (Flag model is deferred — Phase 3.)

## Keeping `main` releasable (why there is no release branch)

Fix-forward only works if `main` is always shippable. Do not merge work that cannot go to production
without gating it behind a `FEATURE_*` flag. That is the trunk-based trade: instead of maintaining a
protected `release/*` branch to patch an older version off-trunk, you keep unreleased-but-unshippable
work behind flags so the next release (including a hotfix) is always safe to cut from `main`.

For the rare case where production must be patched **without** shipping newer `main` commits and a
flag is not viable, the fix is an **ad-hoc, unprotected** operation (branch from the release tag with
`SKIP_BRANCH_CHECK=1`, cherry-pick, deploy the tag) — there is no standing ruleset for it, and it
should be forward-ported to `main` immediately.

## Notes

- There is **no promotion** and **no protected `release/*` branch** — `main.json`
  is the only committed ruleset. The old `production-go-live.md` is retired.
