---
description: Promote dev to production through main with ancestry repair, PR governance, and CI handling
argument-hint: [optional release PR title]
allowed-tools: Bash(git*), Bash(gh*), Bash(pnpm*)
---

Run the complete **dev → production** release workflow. Production is `main`;
non-production integration is `dev`. This command is intentionally scoped to
that branch pair only.

Follow the durable workflow documentation in
[`agent-os/docs/commands/release-dev-to-production.md`](../docs/commands/release-dev-to-production.md)
— it defines the enforcement gates, the Handoff Summary format, and how to force
a specific version.

Use the PR title **$ARGUMENTS** if provided; otherwise use today's local date
in `YYYY-MM-DD` format:
`chore(release): promote dev to main (YYYY-MM-DD)`.

Hard stops:

- Do not release from any branch except `dev`.
- Do not target any production branch except `main`.
- Do not force-push.
- Do not push directly to `dev` or `main`; all branch updates go through PRs.
- Do not merge the final `dev` → `main` release PR yourself — drive it to
  merge-ready and hand off to the user with the Handoff Summary (see docs); the
  user performs the merge.
- Do not squash any PR whose purpose is to merge `main` ancestry into `dev`;
  those PRs must use the merge-commit method.

Workflow summary:

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
5. Verify the comprehensive matrix is green on the `dev` HEAD being promoted
   (post-merge CI runs `Matrix Tests` on every `dev` push). Do **not** promote
   on a red matrix — `release-please` on `main` is gated on it, so a red matrix
   strands the release after merge (no tag, no deploy, no back-merge).
6. Find an existing open release PR from `dev` to `main`. If none exists, open
   one with the chosen title.
7. Ensure the release PR title is release/promote-shaped. Prefer today's local
   date in `YYYY-MM-DD` format:
   `chore(release): promote dev to main (YYYY-MM-DD)`.
8. Check PR governance:
   - PR Governance `Checks`
   - mergeability / conflict state
   - branch update state
   - required reviews
   - required status checks
9. If the release PR is `BEHIND`, repeat the ancestry repair step. `main` may
   have advanced while the workflow was running.
10. If the release PR has conflicts, resolve them on a short-lived branch/PR into
   `dev`, taking release-owned files from `main` unless the user explicitly
   requests a different release-version policy.
11. Watch all release PR checks. For failures, inspect logs, identify the root
    cause, and fix only issues introduced by the release merge.
12. When required checks are green and the PR is mergeable, **stop — do not
    merge**. Emit the Handoff Summary (see docs) and ask the user to merge the
    release PR with a **merge commit**. Never merge it yourself, never use the
    admin bypass to merge on their behalf, never self-approve. If review is
    pending, name the exact blocker.
13. After the user confirms the merge, fetch `main` and verify the automatic
    cascade: release-please tag + GitHub Release, Railway prod deploy +
    post-deploy `/readyz` smoke, automatic `main` → `dev` back-merge.
14. Report:
    - release PR URL
    - merge commit (performed by the user)
    - final checks/review status
    - release-please + deploy + back-merge status

Final report format:

- Release PR:
- Ancestry repair PR(s), if any:
- Checks:
- Reviews:
- Merge result or blocker:
