# GitHub automation (core-be)

Long-lived branches: **`dev`** (development), **`main`** (production).

Workflow **file names** describe *what* runs; the YAML `name:` field is what appears in the GitHub Actions UI and in required status checks (`{workflow name} / {job name}`).

## Orchestrator workflows (triggered directly)

| What it does | File | GitHub UI name (`name:`) | When it runs | Required on PR? |
| ------------ | ---- | ------------------------ | ------------ | --------------- |
| PR merge gate (lint, typecheck, unit, build) | [pr-ci.yml](workflows/pr-ci.yml) | **PR CI** | `pull_request` → `main`, `dev` | Yes (7 parallel jobs) |
| PR title, labels, `.env` guard | [pr-governance.yml](workflows/pr-governance.yml) | **PR Governance** | Every PR event | Yes (`Checks`) |
| Post-merge pipeline (integration, Docker, deploy, release) | [post-merge-ci.yml](workflows/post-merge-ci.yml) | **Post-merge CI** | Push to `main`, `dev`; manual | No |
| Docs lint + link check (markdown only) | [pr-docs-lane.yml](workflows/pr-docs-lane.yml) | **Docs lane** | PR that touches `*.md` | No |
| Manual Railway deploy (emergency) | [cd.yml](workflows/cd.yml) | **CD** | `workflow_dispatch` only | No |
| Nightly k6 load + SLO gate | [scheduled-k6-load-slo.yml](workflows/scheduled-k6-load-slo.yml) | **Scheduled k6 API load & SLO** | Daily 02:00 UTC + manual | No |
| Monthly backup restore + RTO | [scheduled-monthly-restore-rto.yml](workflows/scheduled-monthly-restore-rto.yml) | **Monthly backup restore & RTO drill** | 1st of month 06:00 UTC + manual (fully automated Neon PITR) | No |
| Stryker mutation score | [scheduled-stryker-mutation.yml](workflows/scheduled-stryker-mutation.yml) | **Scheduled Stryker mutation testing** | Weekly Sunday + manual | No |
| Dependabot CI failure triage | [dependabot-ci-triage.yml](workflows/dependabot-ci-triage.yml) | **Dependabot CI triage** | After failed PR CI on Dependabot PRs | No |

## Reusable workflows (called from `pr-ci.yml` / `post-merge-ci.yml`)

| What it does | File | GitHub UI name (`name:`) |
| ------------ | ---- | ------------------------ |
| Vitest unit + global (`--changed`, no DB) | [reusable-vitest-unit-only.yml](workflows/reusable-vitest-unit-only.yml) | Reusable — Vitest unit (no DB) |
| Vitest integration shards (Postgres + Redis) | [reusable-vitest-postgres-redis.yml](workflows/reusable-vitest-postgres-redis.yml) | Reusable — integration tests with Postgres and Redis |
| Toxiproxy chaos suite | [reusable-chaos-toxiproxy.yml](workflows/reusable-chaos-toxiproxy.yml) | Reusable — chaos via Toxiproxy |
| Docker build, Trivy, GHCR push, container smoke | [reusable-docker-build-trivy.yml](workflows/reusable-docker-build-trivy.yml) | Reusable — Docker build and verify |
| OpenAPI + Postman + Scalar publish | [reusable-openapi-postman-publish.yml](workflows/reusable-openapi-postman-publish.yml) | Reusable — generate API docs |
| Railway deploy (+ post-deploy API smoke) | [cd.yml](workflows/cd.yml) | CD |

## Composite actions

| Action | Path | Used by |
| ------ | ---- | ------- |
| Setup Node and pnpm | [actions/setup-node-pnpm](actions/setup-node-pnpm/action.yml) | Reusable workflows, deploy, k6 |
| Export CI test env (JWT keys, retention) | [actions/test-env](actions/test-env/action.yml) | Vitest, chaos, Docker, k6 |
| Start API server | [actions/start-api-server](actions/start-api-server/action.yml) | k6 load tests |
| Stop API server | [actions/stop-api-server](actions/stop-api-server/action.yml) | k6 load tests |

## Other config

- [dependabot.yml](dependabot.yml) — dependency update PRs
- [workflows/dependabot-ci-triage.yml](workflows/dependabot-ci-triage.yml) — GitHub issue when PR CI fails on a Dependabot PR
- [labeler.yml](labeler.yml) — path-based PR labels (attached by PR Governance)
- [labels.yml](labels.yml) — manual reference for label definitions (name + pastel color + description)
- [release-please/](release-please/) — release-please configs + manifests for `main` (stable) and `dev` (prerelease) channels
- [rulesets/](rulesets/) — branch protection JSON for `main`, `dev`
- [CODEOWNERS](CODEOWNERS) — review assignments

See [docs/deployment/ci-cd/branch-protection.md](../docs/deployment/ci-cd/branch-protection.md) for required check names (must match `PR CI / …` and `PR Governance / …`).

## Node.js 24 (Actions runtime + project)

GitHub is migrating JavaScript-based actions from Node 20 to Node 24. Every workflow sets:

```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

Project jobs install Node from [`.nvmrc`](../.nvmrc) via [actions/setup-node-pnpm](actions/setup-node-pnpm/action.yml) (`actions/setup-node@v6`, `pnpm/action-setup@v6`).

Pinned first-party and third-party actions (representative):

| Action | Version |
| ------ | ------- |
| `actions/checkout` | `@v6` |
| `actions/setup-node` | `@v6` |
| `actions/cache` | `@v5` |
| `actions/upload-artifact` / `download-artifact` | `@v7` / `@v8` |
| `actions/github-script` | `@v9` |
| `actions/labeler` | `@v6` |
| `actions/setup-python` | `@v6` |
| `googleapis/release-please-action` | `@v5` |
| `softprops/action-gh-release` | `@v3` |
| `anchore/sbom-action` | `@v0.24.0` |
| `docker/login-action` | `@v4` |
| `docker/setup-buildx-action` | `@v4` |
| `docker/build-push-action` | `@v7` |
| `aquasecurity/trivy-action` | `@v0.36.0` |

Policy enforced in `src/tests/unit/ci/github-actions-node24.policy.unit.test.ts`.
