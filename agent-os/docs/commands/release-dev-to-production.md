# Release Dev To Production — RETIRED

`/release-dev-to-production` belonged to the `dev`+`main` **dual-channel promotion**
model, which no longer exists. The repository is now **single-trunk** (`main` is the
only long-lived branch — see
[`docs/process/delivery-model-migration-plan.md`](../../../docs/process/delivery-model-migration-plan.md)).
There is no `dev → main` promotion, no ancestry repair, and no post-release back-merge.

## How to ship now

1. Squash-merge every change into `main` (behind the `Quality gate` + `Checks` required checks).
2. `release-please` keeps one open Release PR (`chore: release X.Y.Z`) current on every merge.
3. **Merge that Release PR — that is the ship button.** It tags `vX.Y.Z` + publishes the
   GitHub Release, which fires
   [`release-deploy.yml`](../../../.github/workflows/release-deploy.yml) to deploy production
   (behind the environment reviewer approval), promoting the exact scanned image.

See the retired command stub [`agent-os/commands/release-dev-to-production.md`](../../commands/release-dev-to-production.md)
and [`docs/deployment/ci-cd/cicd-and-deployment.md`](../../../docs/deployment/ci-cd/cicd-and-deployment.md)
for the current CI/CD + release flow.
