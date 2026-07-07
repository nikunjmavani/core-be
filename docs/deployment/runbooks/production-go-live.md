# Runbook: Production go-live

core-be is **single-trunk** — `main` is the only long-lived branch, and it deploys to the
development environment on every merge and to production on release.

**How shipping to production works:**

- Every change squash-merges into `main` via a PR ([git-workflow.md](../../process/git-workflow.md)),
  behind the `Quality gate` + `Checks` required checks.
- `release-please` keeps one `chore: release X.Y.Z` Release PR open. **Merging it is the ship button** —
  it tags the release and fires `release-deploy.yml` to deploy production (behind the environment
  reviewer approval) ([release-versioning.md](../../process/release-versioning.md)).
- Urgent fixes: [hotfix-release.md](hotfix-release.md).
- Rollback: [rollback-deploy.md](rollback-deploy.md).

Local setup: [SETUP.md](../../../SETUP.md). Full CI/CD + deploy reference:
[cicd-and-deployment.md](../ci-cd/cicd-and-deployment.md).
