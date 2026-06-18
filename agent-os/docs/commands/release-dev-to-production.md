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

15. When checks are green but review is required, stop and report the exact
    approval blocker.

16. When checks and reviews are satisfied, merge the final `dev` to `main` PR
    using the repo's configured production merge method.

17. After merge, fetch `main` and report:

    - release PR URL
    - merge commit
    - final checks and review status
    - whether any follow-up release-please PR was opened on `main`

## Final Report Format

```text
Release PR:
Ancestry repair PR(s), if any:
Checks:
Reviews:
Merge result or blocker:
```
