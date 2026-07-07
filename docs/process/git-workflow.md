# Git workflow

**Single-trunk model.** `main` is the only long-lived branch. Every change lands on `main` through a
squash-merged pull request; there is no `dev` branch, no promotion, and no back-merge. Incomplete work
hides behind feature flags, not long-lived branches.

> Migrated from the former `dev`+`main` dual-channel model — see
> [delivery-model-migration-plan.md](delivery-model-migration-plan.md). For CI/CD and deployment see
> [cicd-and-deployment.md](../deployment/ci-cd/cicd-and-deployment.md).

## Branches

| Branch | Purpose | Lifetime |
| --- | --- | --- |
| `main` | The trunk. Always releasable. Protected (squash-only, required checks). | permanent |
| `<type>/<slug>` | Working branch for one change (`feat`/`fix`/`chore`/`refactor`/`docs`/`test`/`ci`/`build`/`perf`/`hotfix`). | short-lived, deleted on merge |
| `release/X.Y` | Hotfix branch for an **older** release trunk has moved past. One-way (never merged back). | short-lived |
| `claude/*` | Claude Code web session branches. | short-lived |

Enforced by [`.husky/pre-push`](../../.husky/pre-push) and the `git-branch-naming` rule.

## The loop

1. Branch off `main`: `git switch -c feat/my-change`.
2. Commit; open a PR to **`main`** (`/open-pr` or `/ship`).
3. **PR CI is the authoritative gate**: lint, typecheck, unit, the full DB-backed **matrix / Integration**
   suite (e2e/integration/rls/performance), security, contract. It must be green — and the branch up to
   date with `main` (strict checks) — before merge.
4. **Squash-merge** into `main` (0 approvals required; the squash commit = the PR title + body). The
   branch auto-deletes.
5. Post-merge CI on `main` runs the **adaptive lane**: a single-PR push takes the FAST lane (build →
   release-please → deploy development, no re-test — the PR already proved the tree); a batched push
   (≥2 commits, e.g. a merge queue) takes the FULL lane and re-runs the matrix.

## Releasing

`release-please` keeps exactly one **`chore: release X.Y.Z` Release PR** open on `main`, updated on
every merge. **Merging that Release PR is the ship button** — it tags `vX.Y.Z` + a GitHub Release, which
fires [`release-deploy.yml`](../../.github/workflows/release-deploy.yml) to deploy production (behind the
environment reviewer approval). See [release-versioning.md](release-versioning.md).

## Hotfixes

A normal urgent fix is just a `fix:` PR merged and released immediately by merging the Release PR. To
patch an older release, use a `release/X.Y` branch — see
[hotfix-release.md](../deployment/runbooks/hotfix-release.md).

## Local clone migration (one-time, after cutover)

If you still have a local `dev`:

```bash
git fetch --prune
git remote set-head origin -a
git switch main
git branch -D dev   # stale local dev; it no longer exists upstream
```

Rebase any in-flight feature branch that was cut from `dev` onto `main`:
`git rebase --onto origin/main origin/dev <branch>`.
