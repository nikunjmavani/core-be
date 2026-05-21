# GitHub Environments (IaC)

JSON files here declare protection rules for [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) used by [deploy-railway.yml](../workflows/deploy-railway.yml).

| File | GitHub Environment | Protection |
| ---- | -------------------- | ---------- |
| [production.json](production.json) | `production` | Required reviewers, deployment branches |
| [qa.json](qa.json) | `qa` | None (extend when needed) |
| [dev.json](dev.json) | `dev` | None (extend when needed) |

**Drift check:** `pnpm validate:github-environments` (requires `gh auth login`). Also runs as part of `pnpm validate:github-env` before deploy.

**When reviewers change:** update GitHub UI and the matching `users` / `teams` in `production.json` in the same PR.

See [docs/deployment/github-production-environment.md](../../docs/deployment/github-production-environment.md).
