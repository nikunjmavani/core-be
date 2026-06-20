# Release Dev To Production

`/release-dev-to-production` is the common agent workflow for promoting `dev` to
production through `main`.

This document is the durable workflow reference. The slash command in
[`agent-os/commands/release-dev-to-production.md`](../../commands/release-dev-to-production.md)
is the executable prompt surface shared by Claude Code, Cursor, and Codex.

## Scope

The workflow is intentionally limited to this branch pair:

- Source: `dev`
- Production target: `main`

Do not use this command for feature branches, hotfix branches, or environment
pairs other than `dev` to `main`.

## Default Title

If the user does not provide a title, use today's local date in `YYYY-MM-DD`
format:

```text
chore(release): promote dev to main (YYYY-MM-DD)
```

For example:

```text
chore(release): promote dev to main (2026-06-18)
```

## Hard Stops

- Do not release from any branch except `dev`.
- Do not target any production branch except `main`.
- Do not force-push.
- Do not push directly to `dev` or `main`; all branch updates go through PRs.
- Do not merge the final `dev` to `main` release PR unless required checks are
  green and required review rules are satisfied.
- Do not squash any PR whose purpose is to merge `main` ancestry into `dev`.
  Those PRs must use the merge-commit method.
- Do not merge the final `dev` to `main` release PR yourself. Drive it to
  merge-ready, then hand off to the user with the [Handoff Summary](#handoff-summary).

## Enforcement Gates

Enforced by the `main` ruleset
([`.github/rulesets/main.json`](../../../.github/rulesets/main.json)), so the
workflow drives the release PR to **merge-ready** against these and never
bypasses them:

- **Required status checks** (strict; branch must be up to date): `Lint`,
  `Typecheck`, `Static sync`, `unit / Unit + global`, `Migration lint`,
  `Build verify`, `Security audit`, `Security secrets`, `Security SAST`,
  `Contract + property`, `RLS security (non-superuser)`, `Checks`. These are the
  real protection — never report merge-ready until all are green, never bypass.
- **Required review:** 1 code-owner approval, `require_last_push_approval`,
  `required_review_thread_resolution`. **The user, not the agent, merges.**
  - Sole code owner today (`@nikunjmavani`, see
    [`.github/CODEOWNERS`](../../../.github/CODEOWNERS)): the author cannot
    approve their own PR, so the user merges as admin — the ruleset's
    `bypass_actors` / `bypass_mode: pull_request` exists for this solo-owner
    case. The admin bypass covers the approval only, **never** the status checks.
  - When CODEOWNERS becomes a team, the same step is a teammate's approval.
- **Merge method locked to `merge` commit** (`allowed_merge_methods: ["merge"]`)
  — squash/rebase are rejected on `main`, so commit ancestry and release-please's
  version math are enforced, not just advised.
- **Signed commits**, no force-push, no branch deletion.
- **Deploy + post-deploy `/readyz` smoke** (post-merge CI) is the last automated
  gate before traffic.

## Workflow

1. Fetch fresh refs:

   ```bash
   git fetch origin main dev
   ```

2. Confirm the branch map:

   - Production branch: `origin/main`
   - Release source branch: `origin/dev`

   Stop if repository identity or project config says otherwise.

3. Check whether `dev` contains the latest `main`:

   ```bash
   git merge-base --is-ancestor origin/main origin/dev
   ```

4. If `dev` is behind `main`, repair ancestry first:

   ```bash
   git switch -c chore/merge-main-ancestry-dev-YYYYMMDDHHMM origin/dev
   git merge --no-ff origin/main -m "chore(release): merge main ancestry into dev"
   ```

   If conflicts occur in release-owned files, take the version from `main`:

   - `package.json`
   - `.github/release-please/manifest.json`
   - `CHANGELOG.md`

   Resolve any non-release conflict conservatively and explain it in the PR.

5. Verify the ancestry repair branch:

   ```bash
   git merge-base --is-ancestor origin/main HEAD
   node -p "require('./package.json').version"
   ```

   Also inspect `.github/release-please/manifest.json`.

6. Push the ancestry branch and open a PR to `dev` titled:

   ```text
   chore(release): merge main ancestry into dev
   ```

7. Watch PR governance and CI for the ancestry PR. Fix only issues introduced by
   the ancestry merge.

8. Merge the ancestry PR into `dev` with the merge-commit method.

9. Fetch again and verify:

   ```bash
   git fetch origin main dev
   git merge-base --is-ancestor origin/main origin/dev
   ```

10. Find an existing open release PR from `dev` to `main`. If none exists, open
    one using the chosen release title.

11. Check release PR governance:

    - PR Governance `Checks`
    - mergeability and conflict state
    - branch update state
    - required reviews
    - required status checks

12. If the release PR is `BEHIND`, repeat the ancestry repair step. `main` may
    have advanced while the workflow was running.

13. If the release PR has conflicts, resolve them on a short-lived branch and PR
    into `dev`. Take release-owned files from `main` unless the user explicitly
    requests a different release-version policy.

14. Watch all release PR checks. For failures, inspect logs, identify the root
    cause, and fix only issues introduced by the release merge.

15. When required checks are green and the PR is mergeable, **stop — do not
    merge.** Emit the [Handoff Summary](#handoff-summary) and ask the user to
    merge the release PR with a **merge commit**. The merge to `main` is the
    user's deliberate action — never merge it yourself, never use the admin
    bypass to merge on their behalf, never self-approve. If review is still
    pending, name the exact approval blocker in the summary.

16. After the user confirms the merge, fetch `main` and verify the automatic
    post-merge cascade, reporting each:

    - release-please cuts the stable tag + published GitHub Release (`vX.Y.Z`)
    - Railway deploys API + worker to `production`; post-deploy `/readyz` smoke
      passes (`database` / `redis` / `bullmq` connected)
    - the automatic `main → dev` back-merge PR opens and merges (reseeds the dev
      prerelease window)

17. Produce the [Final Report](#final-report-format).

## Handoff Summary

When the release PR is merge-ready (Workflow step 15), emit this verbatim (with
`<…>` filled in) and hand off — do not merge:

```text
## ✅ Ready to promote to production — your merge required

PR #<n> · <release PR title>
<pr_url>

Shipping <commit_count> commit(s) → stable v<X.Y.Z>
Review/merge: <code owners for the changed paths> — sole owner today, so you
merge as admin (you can't self-approve your own PR)

Release notes (this window — from CHANGELOG-dev.md, becomes CHANGELOG.md):
<grouped user-facing entries, feat: / fix: / perf: first; fall back to
git log --oneline origin/main..origin/dev>

Gates (all green):
• Ancestry — origin/main is an ancestor of origin/dev ✅
• Required status checks — all <count> green ✅
• Mergeable — clean ✅
• Review — <satisfied | awaiting @code-owner>

👉 Action for you: merge PR #<n> now using "Merge commit" (squash/rebase are
blocked on main).

After you merge, this runs automatically (typically a few minutes) — I'll watch
and confirm each:
1. release-please cuts tag + GitHub Release v<X.Y.Z>
2. Railway deploys API + worker to production
3. Post-deploy smoke: GET <prod_api_url>/readyz → database / redis / bullmq "connected"
4. Automatic main → dev back-merge (reseeds dev to the next -dev.0 window)

If step 3 fails: rollback = redeploy the previous API + worker image tags; the
back-merge holds until deploy is green.

Say "merged" when done, or "hold" to stop.
```

Fill the `<…>` from: **code owners** →
[`.github/CODEOWNERS`](../../../.github/CODEOWNERS) matched to the changed paths;
**release notes** → `CHANGELOG-dev.md` for this version window (fall back to
`git log --oneline origin/main..origin/dev`); **`<prod_api_url>`** → the
production Railway API domain (`production` GitHub Environment);
**`<version>` / `<X.Y.Z>`** → the dev line's base version (drop the `-dev.N`).

## Final Report Format

```text
Release PR:
Ancestry repair PR(s), if any:
Checks:
Reviews:
Merge result or blocker:
```

## Forcing a Specific Version

release-please computes the version from conventional-commit prefixes since the
last stable tag — you normally never type a number. Two channels: `dev` emits
prereleases (`vX.Y.Z-dev.N`, `manifest.dev.json`); `main` cuts stable
(`vX.Y.Z`, `manifest.json`).

To override the computed number:

- **Forward jump (supported, clean).** Add a `Release-As: X.Y.Z` footer to a
  commit on the channel being released (see
  [`docs/process/release-versioning.md`](../../../docs/process/release-versioning.md)):

  ```bash
  git commit --allow-empty -m "chore: release 5.0.0" -m "Release-As: 5.0.0"
  ```

  A `feat!:` / `BREAKING CHANGE:` commit bumps the major naturally — prefer that
  when the bump reflects a real breaking change.
- **Forward only — you cannot jump down.** A lower target (e.g. `1.0.0` while the
  repo is on `4.x`) is rejected: the `version_greater_or_equal` guard in
  [`post-release-backmerge.yml`](../../../.github/workflows/post-release-backmerge.yml)
  keeps the dev seed non-decreasing, and a lower number breaks SemVer ordering,
  Docker `:latest`, and changelog order.
- **Hard re-baseline (last resort, breaking).** To truly reset the line, manually
  reseed `manifest.json`, `manifest.dev.json`, and `package.json`; accept that
  older `vX.Y.Z` tags stay numerically higher; and override the non-decreasing
  guard for that one cycle. Get explicit human sign-off first — it rewrites the
  project's whole version history.
