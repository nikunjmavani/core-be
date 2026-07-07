---
description: RETIRED — single-trunk model has no dev→main promotion; shipping is merging the Release PR
argument-hint: [none]
allowed-tools: Bash(true)
---

# Retired: `/release-dev-to-production`

This command belonged to the `dev`+`main` dual-channel model. The repository is now
**single-trunk** (`main` is the only long-lived branch — see
[`docs/process/delivery-model-migration-plan.md`](../../docs/process/delivery-model-migration-plan.md)).
There is no `dev → main` promotion, no ancestry repair, and no back-merge anymore.

**How to ship now:** every feature squash-merges into `main`; `release-please` keeps one
open Release PR (`chore: release X.Y.Z`) up to date. **Merging that Release PR is the ship
button** — it tags the release, which fires `release-deploy.yml` to deploy production (with the
environment reviewer approval). Nothing to run here.
