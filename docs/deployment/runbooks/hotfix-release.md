# Runbook: Hotfix release (single-trunk)

How to ship an urgent fix under the single-`main` delivery model. See the
[delivery-model migration plan](../../process/delivery-model-migration-plan.md) for the full model.

There are two cases. **Prefer case A** — a normal fast fix on trunk. Only use case B when you must
patch an **older** release that trunk has already moved past.

## A. Normal urgent fix (the common case — no extra branch)

1. Cut a `fix/<slug>` branch off `main`, make the fix, open a PR to `main`.
2. CI runs the authoritative gate (lint, typecheck, unit, **matrix / Integration**, security). When
   green, **squash-merge** it (0 approvals required — D8).
3. The post-merge run refreshes the **`chore: release X.Y.Z` Release PR**. **Merge that Release PR** —
   that is the ship button: it tags the release, which fires `release-deploy.yml` to deploy production
   (behind the environment reviewer approval).

That's it — a hotfix is just a `fix:` change that you release immediately by merging the Release PR,
instead of waiting for the next cadence release.

## B. Patch an OLDER release (trunk has moved on)

Use when production runs `vX.Y.0` but `main` already contains unrelated unreleased work you cannot
ship, and you must patch `vX.Y`.

1. Branch from the release tag:

   ```bash
   git switch -c release/X.Y vX.Y.0
   git push -u origin release/X.Y
   ```

   `release/*` is protected by [`.github/rulesets/release.json`](../../../.github/rulesets/release.json)
   (squash-only, the same required checks as `main` minus strict-up-to-date) and allowlisted in
   `.husky/pre-push`.

2. Land the fix on `release/X.Y` via a `fix/*` PR (cherry-pick from `main` if the fix already landed
   there — **one-way only**; never merge `release/*` back into `main`).

3. Cut the patch release on that branch by dispatching post-merge CI against it:

   ```bash
   gh workflow run post-merge-ci.yml --ref release/X.Y
   ```

   release-please (with `target-branch: release/X.Y`) cuts `X.Y.(Z+1)`. Merging its Release PR tags
   `vX.Y.(Z+1)`; the tag matches the production environment's `v*` deploy policy, so
   `release-deploy.yml` deploys it.

4. **Forward-port**: make sure the same fix exists on `main` (cherry-pick if it originated on the
   release branch). The `release/X.Y` branch is disposable once the patch ships — delete it.

## Notes

- **Rollback** instead of hotfix when the fix isn't ready: `rollback-deploy.yml` redeploys the
  previous production image (see [rollback-deploy.md](rollback-deploy.md)).
- **Feature flags** are usually the faster mitigation than a code hotfix — flipping a
  `FEATURE_*` variable is a config-only redeploy, no release. (Flag model is deferred — Phase 3.)
- There is **no `dev` branch and no promotion** anymore; the old
  `runbook-dev-to-production.md` is retired.
