# GitHub Environments (IaC)

JSON files here declare protection rules for [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) used by [reusable-railway-deploy.yml](../workflows/reusable-railway-deploy.yml).

**Canonical mapping source:** [`tooling/setup/setup.config.json`](../../tooling/setup/setup.config.json). Run `pnpm tool:generate-project-identity` after manifest changes to regenerate identity constants and the CI composite action.

| Branch | GitHub Environment | `NODE_ENV` |
| ------ | ------------------ | ---------- |
| `main` | `production`       | `production` |
| `dev`  | `development`      | `development` |

| Config file | GitHub Environment | Protection |
| ----------- | ------------------ | ---------- |
| [production.json](production.json) | `production` | Required reviewers, deployment branches |
| [development.json](development.json) | `development` | None (extend when needed) |

**API docs uploads** (Postman workspace, Scalar Registry) use the same GitHub Environment on push: `dev` → `development`, `main` → `production`. Set `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID`, `SCALAR_API_KEY`, `SCALAR_NAMESPACE`, and optional `SCALAR_SLUG` per environment (e.g. `core-be-dev` vs `core-be`) so hosted docs do not overwrite each other.

**Source of truth for env values.** Each environment's secrets and variables live in a gitignored `.env.<environment>` file at the repo root, derived from the committed `.env.example`. `pnpm github:sync <environment>` pushes them to the matching GitHub Environment.

**Bootstrap (first time):**

```bash
pnpm tool:generate-project-identity  # refresh identity constants + CI composite action from setup.config.json
pnpm github:sync              # creates missing .env.<environment> files from setup.config.json
# Edit each file with real values (DB URL, JWT keys, Sentry DSN, etc.)
pnpm github:sync              # branches + rulesets + environments + push values (confirms before push)
```

`github:sync` runs the full pipeline: ensure protected branches exist, sync committed rulesets from [`.github/rulesets/`](../rulesets/), create GitHub Environments from this folder, then push each local `.env.<environment>` file. Preview without writes: `pnpm github:sync:dry-run`.

**One environment only** (same full pipeline, values limited to that environment): `pnpm github:sync <environment>`.

`github:sync` automatically:

- creates the GitHub Environment (idempotent),
- pushes anything under `.env.<environment>`'s **GitHub Secrets** half as a Secret (`gh secret set`) and anything under the **GitHub Variables** half as a Variable (`gh api .../variables`) — the file structure is the source of truth,
- skips empty entries (operators can leave optional integrations blank).

Preview without pushing: `pnpm github:sync <environment> --dry-run`.

**Re-syncing** after editing a value: `pnpm github:sync <environment>` again — idempotent, overwrites in place.

**Adding a new environment** (e.g. `staging`):

1. Add `staging` to the `NODE_ENV` enum in `src/shared/config/env-schema.ts`.
2. Add `{ "name": "staging", "branch": "staging", "nodeEnvironment": "staging" }` to the `environments[]` array in `tooling/setup/setup.config.json`.
3. `pnpm github:sync` — scaffolds local IaC and syncs remote shells.
4. Edit `.env.staging` with real values; update `.github/workflows/reusable-railway-deploy.yml`.
5. `pnpm github:sync staging` — push values to GitHub.

See [docs/deployment/runbooks/add-new-environment.md](../../docs/deployment/runbooks/add-new-environment.md).

**Drift check:** `pnpm github:sync --check` (consistency + branches/rulesets/environments). `pnpm validate:github-environments` (run from the companion `core-infra` repo) compares protection JSON vs GitHub API (requires `gh auth login`).

**When reviewers change:** prefer `pnpm github:tool:governance-mode` (`personal` / `team`) — it sets `production.json` `requiredReviewers.users` + `preventSelfReview` from CODEOWNERS and refuses a deadlocking combo — then `pnpm github:sync`. If you hand-edit `production.json`, run `pnpm github:tool:governance-mode:check` to catch an inconsistent/deadlocking state, and keep the GitHub UI in sync. See [docs/deployment/ci-cd/branch-protection.md](../../docs/deployment/ci-cd/branch-protection.md#governance-mode--personal--team-one-switch).

See [docs/deployment/github-production-environment.md](../../docs/deployment/github-production-environment.md).
