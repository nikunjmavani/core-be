# GitHub automation (core-be)

Long-lived branches: **`dev`** (development), **`main`** (production).

Workflow **file names** describe *what* runs; the YAML `name:` field is what appears in the GitHub Actions UI and in required status checks (`{workflow name} / {job name}`).

## Orchestrator workflows (triggered directly)

| What it does                             | File                                                                             | GitHub UI name (`name:`)               | When it runs                          | Required on PR?                        |
| ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------- | -------------------------------------- |
| Main CI pipeline                         | [pr-branch-ci.yml](workflows/pr-branch-ci.yml)                                   | **CI**                                 | PR + push to `main`, `dev`            | Yes (quality, test, api-smoke, docker) |
| PR title, labels, `.env` guard           | [pr-governance.yml](workflows/pr-governance.yml)                                 | **PR Governance**                      | Every PR event                        | Yes (`Checks`)                         |
| Post-merge gates (chaos, SBOM, API docs) | [post-merge-ci.yml](workflows/post-merge-ci.yml)                                 | **Post-merge CI**                      | Push to `main`, `dev` only            | No                                     |
| Docs lint + link check (markdown only)   | [pr-docs-lane.yml](workflows/pr-docs-lane.yml)                                   | **Docs lane**                          | PR that touches `*.md`                | No                                     |
| Railway deploy after green CI            | [deploy-railway-after-ci.yml](workflows/deploy-railway-after-ci.yml)             | **Deploy Railway after CI**            | After `CI` succeeds on push + manual  | No                                     |
| Nightly k6 load + SLO gate               | [scheduled-k6-load-slo.yml](workflows/scheduled-k6-load-slo.yml)                 | **Scheduled k6 API load & SLO**        | Daily 02:00 UTC + manual              | No                                     |
| Monthly backup restore + RTO             | [scheduled-monthly-restore-rto.yml](workflows/scheduled-monthly-restore-rto.yml) | **Monthly backup restore & RTO drill** | 1st of month 06:00 UTC + manual       | No                                     |
| Manual DR RTO evidence (optional)        | [manual-dr-rto-record.yml](workflows/manual-dr-rto-record.yml)                   | **Manual DR RTO record (optional)**    | Manual only                           | No                                     |
| Stryker mutation score                   | [scheduled-stryker-mutation.yml](workflows/scheduled-stryker-mutation.yml)       | **Scheduled Stryker mutation testing** | Weekly Sunday + manual                | No                                     |
| Conventional commit on push              | [protected-branch-commitlint.yml](workflows/protected-branch-commitlint.yml)     | **Protected branch commitlint**        | Push to `main`, `dev`                 | No                                     |
| Release versioning PRs                   | [release-please-versioning.yml](workflows/release-please-versioning.yml)         | **Release Please**                     | Push to `main`, `dev`                 | No                                     |
| SBOM on GitHub Release                   | [release-attach-sbom.yml](workflows/release-attach-sbom.yml)                     | **Release SBOM**                       | `release: published`                  | No                                     |
| Dependabot safe auto-merge               | [dependabot-auto-merge.yml](workflows/dependabot-auto-merge.yml)                 | **Dependabot**                         | After `CI` succeeds on Dependabot PRs | No                                     |
| Sync production fixes back to dev        | [sync-main-into-dev.yml](workflows/sync-main-into-dev.yml)                       | **Sync main into dev**                 | Push to `main` + manual               | No                                     |

## Reusable workflows (called from `pr-branch-ci.yml` / `post-merge-ci.yml`)

| What it does                                        | File                                                                                   | GitHub UI name (`name:`)                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| Lint, audit, domain checks, contract/property tests | [reusable-quality-static.yml](workflows/reusable-quality-static.yml)                   | Reusable — quality static                    |
| Vitest shards + coverage (Postgres + Redis)         | [reusable-vitest-postgres-redis.yml](workflows/reusable-vitest-postgres-redis.yml)     | Reusable — test with Postgres and Redis      |
| Live server + seeded API smoke                      | [reusable-api-smoke-live-server.yml](workflows/reusable-api-smoke-live-server.yml)     | Reusable — API smoke with Postgres and Redis |
| Toxiproxy chaos suite                               | [reusable-chaos-toxiproxy.yml](workflows/reusable-chaos-toxiproxy.yml)                 | Reusable — chaos via Toxiproxy               |
| Docker build, Trivy, GHCR push, container smoke     | [reusable-docker-build-trivy.yml](workflows/reusable-docker-build-trivy.yml)           | Reusable — Docker build and verify           |
| OpenAPI + Postman + Scalar publish                  | [reusable-openapi-postman-publish.yml](workflows/reusable-openapi-postman-publish.yml) | Reusable — generate API docs                 |

## Composite actions

| Action                                   | Path                                                            | Used by                                    |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Setup Node and pnpm                      | [actions/setup-node-pnpm](actions/setup-node-pnpm/action.yml)   | Reusable workflows, deploy, commitlint, k6 |
| Export CI test env (JWT keys, retention) | [actions/test-env](actions/test-env/action.yml)                 | Vitest, API smoke, chaos, Docker, k6       |
| Start API server                         | [actions/start-api-server](actions/start-api-server/action.yml) | API smoke, k6                              |
| Stop API server                          | [actions/stop-api-server](actions/stop-api-server/action.yml)   | API smoke, k6                              |

## Other config

- [dependabot.yml](dependabot.yml) — dependency update PRs
- [workflows/dependabot-auto-merge.yml](workflows/dependabot-auto-merge.yml) — safe Dependabot auto-merge plus GitHub issue escalation for skipped security updates
- [labeler.yml](labeler.yml) — path-based PR labels (attached by PR Governance)
- [labels.yml](labels.yml) — manual reference for label definitions (name + pastel color + description)
- [release-please/](release-please/) — release-please configs + manifests for `main` (stable) and `dev` (prerelease) channels
- [rulesets/](rulesets/) — branch protection JSON for `main`, `dev`
- [CODEOWNERS](CODEOWNERS) — review assignments

See [docs/deployment/ci-cd/branch-protection.md](../docs/deployment/ci-cd/branch-protection.md) for required check names (must match `CI / …` and `PR Governance / …`).
