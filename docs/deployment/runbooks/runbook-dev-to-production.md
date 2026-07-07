# Runbook: Development to Production — RETIRED

This runbook described the `dev`+`main` **dual-channel promotion** flow, which no longer exists.
core-be is now **single-trunk** (`main` is the only long-lived branch — see
[delivery-model-migration-plan.md](../../process/delivery-model-migration-plan.md)).

**How shipping works now:**

- Every change squash-merges into `main` via a PR ([git-workflow.md](../../process/git-workflow.md)).
- `release-please` keeps one `chore: release X.Y.Z` Release PR open. **Merging it is the ship button** —
  it tags the release and fires `release-deploy.yml` to deploy production ([release-versioning.md](../../process/release-versioning.md)).
- Urgent fixes: [hotfix-release.md](hotfix-release.md).
- Rollback: [rollback-deploy.md](rollback-deploy.md).

Local setup: [SETUP.md](../../../SETUP.md). CI/CD: [cicd-and-deployment.md](../ci-cd/cicd-and-deployment.md).
