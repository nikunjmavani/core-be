# GitHub production environment (manual approval)

How **production** deploys are gated in GitHub Actions when using [deploy-railway.yml](../../.github/workflows/deploy-railway.yml). There is **no Terraform** in this repository — environment protection rules are declared in [`.github/environments/`](../../.github/environments/) and applied in the GitHub UI.

---

## Environments

| GitHub Environment | Branch trigger (`workflow_run` after CI) | Railway target |
| ------------------ | ---------------------------------------- | -------------- |
| `production` | `main` | Production API + worker services |
| `dev` | `dev` | Development stack |

Manual dispatch (`workflow_dispatch`) can target any of the three via the `target` input.

---

## Required protection on `production`

Configure in **Settings → Environments → production**:

1. **Required reviewers** — at least one team member (platform or release manager) must approve before the deploy job runs.
2. **Deployment branches** — restrict to `main` only (optional but recommended).
3. **Environment secrets** — `DATABASE_URL`, `RAILWAY_TOKEN`, `JWT_SECRET`, etc. per [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md). Do not reuse dev secrets.

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

| Command | Purpose |
| ------- | ------- |
| `pnpm validate:github-environments` | Compare committed config vs live GitHub UI (all `*.json` in `.github/environments/`) |
| `pnpm validate:github-env` | Same drift check **plus** `.env.example` secrets and `METRICS_*` deploy sync (runs in [deploy-railway.yml](../../.github/workflows/deploy-railway.yml)) |

Use `SKIP_GITHUB_ENV=1` to skip API calls locally when you only need deploy-sync or secret checks.

**When reviewers change:** update GitHub (**Settings → Environments → production → Required reviewers**) and the matching `users` / `teams` arrays in `.github/environments/production.json` in the same change.

Infrastructure (Neon, Upstash, Railway) is provisioned via `pnpm setup:infra` ([setup-automation.md](setup/setup-automation.md)), not Terraform in this repo. GitHub environment rules are the **manual approval** layer for production code deploys.

---

## Related

- [branch-protection.md](ci-cd/branch-protection.md) — required CI checks before merge
- [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md) — full pipeline diagram
- [runbook-dev-to-production.md](runbooks/runbook-dev-to-production.md) — release checklist
