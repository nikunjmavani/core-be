# GitHub Environments (IaC)

JSON files here declare protection rules for [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) used by [deploy-railway.yml](../workflows/deploy-railway.yml).

**Canonical mapping** (branch ↔ GitHub Environment ↔ `NODE_ENV`):

| Branch | GitHub Environment | `NODE_ENV` |
| ------ | ------------------ | ---------- |
| `main` | `production`       | `production` |
| `dev`  | `development`      | `development` |

| Config file | GitHub Environment | Protection |
| ----------- | ------------------ | ---------- |
| [production.json](production.json) | `production` | Required reviewers, deployment branches |
| [development.json](development.json) | `development` | None (extend when needed) |

**API docs uploads** (Postman workspace, Scalar Registry) use the same GitHub Environment on push: `dev` → `development`, `main` → `production`. Set `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID`, `SCALAR_API_KEY`, `SCALAR_NAMESPACE`, and optional `SCALAR_SLUG` per environment (e.g. `core-be-dev` vs `core-be`) so hosted docs do not overwrite each other.

**Source of truth for env values.** Each environment's secrets and variables live in a gitignored `.env.<environment>` file at the repo root, derived from the committed `.env.example`. `pnpm env:sync <environment>` pushes them to the matching GitHub Environment.

**Bootstrap (first time):**

```bash
pnpm env:init                 # creates .env.development + .env.production from .env.example
# Edit each file with real values (DB URL, JWT keys, Sentry DSN, etc.)
pnpm env:sync development     # pushes to GitHub Environment "development"
pnpm env:sync production      # pushes to GitHub Environment "production"
```

`env:sync` automatically:

- creates the GitHub Environment (idempotent),
- pushes anything under `.env.<environment>`'s **GitHub Secrets** half as a Secret (`gh secret set`) and anything under the **GitHub Variables** half as a Variable (`gh api .../variables`) — the file structure is the source of truth,
- skips empty entries (operators can leave optional integrations blank).

Preview without pushing: `pnpm env:sync <environment> --dry-run`.

**Re-syncing** after editing a value: `pnpm env:sync <environment>` again — idempotent, overwrites in place.

**Adding a new environment** (e.g. `staging`):

1. `pnpm env:add staging --branch staging` — scaffolds `.env.staging` (gitignored), `.github/environments/staging.json`, `.github/rulesets/staging.json`.
2. Edit `.env.staging` with real values.
3. `pnpm env:sync staging` — push to GitHub.
4. Edit `.github/workflows/deploy-railway.yml` to add the branch → env mapping.

See [docs/deployment/runbooks/add-new-environment.md](../../docs/deployment/runbooks/add-new-environment.md).

**Drift check:** `pnpm validate:github-environments` (requires `gh auth login`). Also runs as part of `pnpm validate:github-env` before deploy.

**When reviewers change:** update GitHub UI and the matching `users` / `teams` in `production.json` in the same PR.

See [docs/deployment/github-production-environment.md](../../docs/deployment/github-production-environment.md).
