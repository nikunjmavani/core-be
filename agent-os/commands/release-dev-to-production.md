---
description: Promote dev to production through main with ancestry repair, PR governance, and CI handling
argument-hint: [optional release PR title]
allowed-tools: Bash(git*), Bash(gh*), Bash(pnpm*)
---

Run the complete **dev → production** release workflow. Production is `main`;
non-production integration is `dev`. This command is intentionally scoped to
that branch pair only.

Use the PR title **$ARGUMENTS** if provided; otherwise use today's local date
in `YYYY-MM-DD` format:
`chore(release): promote dev to main (YYYY-MM-DD)`.

Hard stops:

- Do not release from any branch except `dev`.
- Do not target any production branch except `main`.
- Do not force-push.
- Do not push directly to `dev` or `main`; all branch updates go through PRs.
- Do not merge the final `dev` → `main` release PR unless required checks are
  green and required review/approval rules are satisfied.
- Do not squash any PR whose purpose is to merge `main` ancestry into `dev`;
  those PRs must use the merge-commit method.

Workflow:

1. Fetch fresh refs:
   `git fetch origin main dev`.
2. Confirm the branch map:
   - production branch: `origin/main`
   - release source branch: `origin/dev`
   Stop if the repository identity/config says otherwise.
3. Check whether `dev` contains the latest `main`:
   `git merge-base --is-ancestor origin/main origin/dev`.
4. If `dev` is behind `main`, repair ancestry first:
   - Create a short-lived branch from `origin/dev`, for example
     `chore/merge-main-ancestry-dev-YYYYMMDDHHMM`.
   - Merge `origin/main` with a real merge commit:
     `git merge --no-ff origin/main -m "chore(release): merge main ancestry into dev"`.
   - If conflicts occur in release-owned files, take the version from `main`:
     `package.json`, `.github/release-please/manifest.json`, `CHANGELOG.md`.
   - Resolve any non-release conflict conservatively and explain it in the PR.
   - Verify:
     `git merge-base --is-ancestor origin/main HEAD`.
   - Push the branch and open a PR to **dev** titled
     `chore(release): merge main ancestry into dev`.
   - Watch PR governance and CI. Fix only issues introduced by the ancestry
     merge.
   - Merge that PR into **dev** with the **merge commit** method.
   - Fetch again and verify:
     `git merge-base --is-ancestor origin/main origin/dev`.
5. Find an existing open release PR from `dev` to `main`. If none exists, open
   one with the chosen title.
6. Ensure the release PR title is release/promote-shaped. Prefer today's local
   date in `YYYY-MM-DD` format:
   `chore(release): promote dev to main (YYYY-MM-DD)`.
7. Check PR governance:
   - PR Governance `Checks`
   - mergeability / conflict state
   - branch update state
   - required reviews
   - required status checks
8. If the release PR is `BEHIND`, repeat the ancestry repair step. `main` may
   have advanced while the workflow was running.
9. If the release PR has conflicts, resolve them on a short-lived branch/PR into
   `dev`, taking release-owned files from `main` unless the user explicitly
   requests a different release-version policy.
10. Watch all release PR checks. For failures, inspect logs, identify the root
    cause, and fix only issues introduced by the release merge.
11. When checks are green but review is required, stop and report the exact
    approval blocker.
12. When checks and reviews are satisfied, merge the final `dev` → `main` PR
    using the repo's configured production merge method.
13. After merge, fetch `main` and report:
    - release PR URL
    - merge commit
    - final checks/review status
    - whether any follow-up release-please PR was opened on `main`

Final report format:

- Release PR:
- Ancestry repair PR(s), if any:
- Checks:
- Reviews:
- Merge result or blocker:
