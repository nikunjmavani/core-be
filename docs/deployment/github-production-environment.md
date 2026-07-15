# GitHub production environment (manual approval)

How **production** deploys are gated in GitHub Actions when using [reusable-railway-deploy.yml](../../.github/workflows/reusable-railway-deploy.yml). There is **no Terraform** in this repository — environment protection rules are declared in [`.github/environments/`](../../.github/environments/) and applied to GitHub by `pnpm github:sync` (reviewers + deployment branch policy), so the committed JSON is the source of truth and drift self-heals on every run.

---

## Environments

| GitHub Environment | Trigger                            | Railway target                   |
| ------------------ | ---------------------------------- | -------------------------------- |
| `development`      | push to `main` (every merge)       | Development stack                |
| `production`       | manual dispatch from `main` (`release-deploy.yml`) | Production API + worker services |

Both environments deploy from `main`; the target GitHub Environment is chosen explicitly, not derived from the branch. Manual dispatch (`workflow_dispatch`) can target either environment via the `target` input.

---

## Required protection on `production`

Declared in [`production.json`](../../.github/environments/production.json) and applied by `pnpm github:sync` — edit the JSON, run the command, GitHub matches it:

1. **Required reviewers** — at least one team member (platform or release manager) must approve before the deploy job runs (`requiredReviewers` in the JSON).
2. **Deployment branch policy** — `protectedBranches` (only a protected branch — `main` — may deploy). Production is deployed by dispatching `release-deploy.yml` **from `main`** with the release tag as an input (`gh workflow run release-deploy.yml --ref main -f tag=vX.Y.Z`). The `release: published` auto-trigger runs with the tag as the deployment ref, which this policy does **not** permit — so release-published does not auto-deploy production; production deploys are dispatched from `main` by design.
3. **Environment secrets** — `DATABASE_URL`, `RAILWAY_TOKEN`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, etc. per [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md). Pushed by the same `pnpm github:sync`; do not reuse dev secrets.

The deploy workflow sets `environment: ${{ needs.resolve-environment.outputs.environment }}` on the deploy job, so GitHub enforces reviewers **only** when the resolved environment is `production` (or when you add reviewers to development).

---

## Reviewer workflow

1. Merge to `main` after green CI on the PR.
2. CI completes on `main` → **Deploy to Railway** `workflow_run` starts.
3. GitHub notifies required reviewers; job waits in **Waiting for review**.
4. Reviewer verifies:
   - Migration notes in PR / release PR
   - No open Sev-1 incidents
   - `pnpm db:migrate:lint` and smoke evidence from CI
5. Approve deployment → Railway build/deploy steps run with production secrets.

Reject or cancel if schema changes need a maintenance window.

---

## IaC and drift detection

Committed JSON under [`.github/environments/`](../../.github/environments/) is the source of truth for each GitHub Environment’s protection rules (required reviewers, deployment branches). Example: [production.json](../../.github/environments/production.json).

| Command                             | Purpose                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:github-environments` (in `core-infra`) | Compare committed config vs live GitHub UI (all `*.json` in `.github/environments/`)                                                                    |
| `pnpm validate:github-env` (in `core-infra`) | Same drift check **plus** `.env.example` secrets and `METRICS_*` deploy sync (runs in [reusable-railway-deploy.yml](../../.github/workflows/reusable-railway-deploy.yml) via `pnpm --dir core-infra …`) |

Use `SKIP_GITHUB_ENV=1` to skip API calls locally when you only need deploy-sync or secret checks.

**When reviewers or the deployment branch policy change:** edit `.github/environments/production.json` and run `pnpm github:sync` — it applies both to GitHub. Verify with `pnpm github:sync --check` (or `pnpm validate:github-environments` from `core-infra`); the release-guard canary enforces it on a schedule.

Infrastructure (Neon, Railway Redis database, Railway) is provisioned via `pnpm setup:infra` in the companion `core-infra` repo ([setup-automation.md](setup/setup-automation.md)), not Terraform in this repo. GitHub environment rules are the **manual approval** layer for production code deploys.

---

## Related

- [branch-protection.md](ci-cd/branch-protection.md) — required CI checks before merge
- [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md) — full pipeline diagram
- [production-go-live.md](runbooks/production-go-live.md) — release checklist
