# GitHub automation (core-be)

Long-lived branches: **`dev`** (development), **`qa`**, **`main`** (production).

## Workflows

| Workflow              | File                                                                     | Triggers                      | Required for merge?           |
| --------------------- | ------------------------------------------------------------------------ | ----------------------------- | ----------------------------- |
| CI                    | [workflows/ci.yml](workflows/ci.yml)                                     | PR + push `main`, `dev`, `qa` | Quality, Test, API smoke, Chaos, Docker Build (Trivy) |
| PR Checks             | [workflows/pr-checks.yml](workflows/pr-checks.yml)                       | PR                            | PR Quality Gates              |
| Deploy to Railway     | [workflows/deploy-railway.yml](workflows/deploy-railway.yml)             | After CI success + manual     | No (post-merge)               |
| CodeQL                | [workflows/codeql.yml](workflows/codeql.yml)                             | PR + push + weekly            | No (advisory)                 |
| Load tests (k6)       | [workflows/load-tests.yml](workflows/load-tests.yml)                     | Nightly + manual              | No                            |
| Commitlint            | [workflows/commit-lint.yml](workflows/commit-lint.yml)                   | Push `main`, `dev`, `qa`      | No (post-push)                |
| Release Please        | [workflows/release-please.yml](workflows/release-please.yml)             | Push `main`                   | No                            |
| Dependabot auto-merge | [workflows/dependabot-automerge.yml](workflows/dependabot-automerge.yml) | Dependabot PRs                | No                            |

## Reusable workflows (called from CI)

| Reusable        | File                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| Quality static  | [workflows/reusable/quality-static.yml](workflows/reusable/quality-static.yml)           |
| Test + coverage | [workflows/reusable/test-with-db.yml](workflows/reusable/test-with-db.yml)               |
| API smoke       | [workflows/reusable/api-smoke-with-db.yml](workflows/reusable/api-smoke-with-db.yml)     |
| Chaos           | [workflows/reusable/chaos-toxiproxy.yml](workflows/reusable/chaos-toxiproxy.yml)         |
| Docker build    | [workflows/reusable/docker-build-verify.yml](workflows/reusable/docker-build-verify.yml) (Trivy; push to GHCR on `main`) |
| API docs        | [workflows/reusable/docs-generate.yml](workflows/reusable/docs-generate.yml)             |

## Composite actions

| Action              | Path                                                            | Used by                                                     |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Setup Node and pnpm | [actions/setup-node-pnpm](actions/setup-node-pnpm/action.yml)   | Reusable workflows, deploy, CodeQL, commit-lint, load-tests |
| Start API server    | [actions/start-api-server](actions/start-api-server/action.yml) | API smoke reusable, load-tests                              |
| Stop API server     | [actions/stop-api-server](actions/stop-api-server/action.yml)   | API smoke reusable, load-tests                              |

## Other config

- [dependabot.yml](dependabot.yml) — dependency update PRs
- [labeler.yml](labeler.yml) — path-based PR labels (via PR Checks)
- [rulesets/](rulesets/) — branch protection JSON for `main`, `dev`, `qa`
- [CODEOWNERS](CODEOWNERS) — review assignments

Issue templates are disabled (use GitHub Discussions or open a PR directly).

See [docs/deployment/ci-cd/branch-protection.md](../docs/deployment/ci-cd/branch-protection.md) for required check names.
