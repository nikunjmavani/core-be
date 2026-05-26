# Runbook: add a new deployment environment

A "new environment" means another hosted target alongside `development` and `production` —
typically `staging` for pre-production validation. This runbook keeps the canonical 1:1
mapping intact across all dimensions.

## Canonical invariant

Every hosted environment must be declared in `.github/sync.config.json`:

```json
{
  "environments": [
    { "name": "development", "branch": "dev" },
    { "name": "production", "branch": "main" }
  ]
}
```

The `name` is both the GitHub Environment and `NODE_ENV` value. The `branch` is
the protected branch that deploys to that environment. Plus the operator-local
artefact:

```text
.env.<environment>   (gitignored; created by `pnpm github:sync`, pushed by `pnpm github:sync`)
```

| Dimension | Lives in |
| --------- | -------- |
| Branch ↔ environment mapping | `.github/sync.config.json` |
| `NODE_ENV` enum value | `src/shared/config/env-schema.ts` |
| `.github/environments/<env>.json` | committed protection config |
| Branch ruleset | `.github/rulesets/<branch>.json` |
| Workflow case mapping | `.github/workflows/reusable-railway-deploy.yml` |
| GitHub Environment (secrets + variables) | live in GitHub UI (managed via `pnpm github:sync`) |
| `.env.<environment>` | repo root, **gitignored** (operator-local; source of truth for `github:sync`) |

`pnpm github:sync --check` enforces the committed dimensions before any GitHub write.
Run it locally before merging plumbing changes.

## Existing hosted environments

| Branch | GitHub Environment | `NODE_ENV` |
| ------ | ------------------ | ---------- |
| `main` | `production`       | `production` |
| `dev`  | `development`      | `development` |

Non-hosted runtime modes (no branch, no GH env): `local`, `test`.

## First-time bootstrap

For an existing environment whose values have not been seeded into GitHub yet:

```bash
pnpm github:sync                   # creates missing .env.<environment> files
# Edit each file with real values
pnpm github:sync development          # push to GitHub
pnpm github:sync production
```

`github:sync` is idempotent — safe to re-run any time you change a value locally.

## Adding a new environment

> Example: adding `staging` deployed from a `staging` branch.

### 1. Confirm the `NODE_ENV` enum already lists the new value

If not, add it to `nodeEnvSchema` in `src/shared/config/env-schema.ts` first and run
`pnpm validate`.

### 2. Update sync config and scaffold local files

Edit `.github/sync.config.json`:

```json
{
  "environments": [
    { "name": "development", "branch": "dev" },
    { "name": "production", "branch": "main" },
    { "name": "staging", "branch": "staging" }
  ]
}
```

Then run:

```bash
pnpm github:sync
```

This creates (idempotent — never overwrites existing files):

- `.env.staging` (local, **gitignored**) — copy of `.env.example`. Edit it with real values.
- `.github/environments/staging.json` (committed) — empty protection by default.
- `.github/rulesets/staging.json` (committed) — branch ruleset matching the default non-production policy.

It also prints the exact next commands.

### 3. Fill in `.env.staging` with real values

Open `.env.staging` and replace placeholders with real `DATABASE_URL`, `REDIS_URL`, JWT
keypair, `SENTRY_DSN`, Railway token, etc. Leave optional integrations blank — `github:sync`
skips empty values.

### 4. Push to GitHub

```bash
pnpm github:sync staging --dry-run    # preview what will be pushed
pnpm github:sync staging              # push for real
```

`github:sync` creates the GitHub Environment and pushes every `KEY=VALUE` according to which
top-level half it sits in inside `.env.<environment>`:

- Anything under `# ### GitHub Secrets ### #` → `gh secret set`.
- Anything under `# ### GitHub Variables ### #` → `gh api .../variables`.

The file structure is the source of truth — no separate classifier file, no override lists.
The `env-schema-add` skill walks through which half + sub-section to pick when adding a new
env var.

### 5. Wire the workflow

Edit `.github/workflows/reusable-railway-deploy.yml`:

```yaml
on:
  workflow_run:
    branches: [main, dev, staging]   # add the new branch
  workflow_dispatch:
    inputs:
      target:
        options:
          - production
          - development
          - staging                  # add the new env
```

```bash
case "${{ github.event.workflow_run.head_branch }}" in
  main)    echo "environment=production"  >> "$GITHUB_OUTPUT" ;;
  dev)     echo "environment=development" >> "$GITHUB_OUTPUT" ;;
  staging) echo "environment=staging"     >> "$GITHUB_OUTPUT" ;;   # add this
  *)       echo "::error::Unsupported branch for deploy" && exit 1 ;;
esac
```

### 6. Apply the branch ruleset

```bash
gh api --method POST repos/:owner/:repo/rulesets \
  --input .github/rulesets/staging.json
```

### 7. Verify everything is 1:1

```bash
pnpm github:sync --check                  # cross-dimension drift + GitHub IaC check
pnpm tool:sync-env-example                # .env.example <-> schema coverage
CONFIG=staging pnpm validate:github-env   # GH env <-> schema required keys
```

All three must exit 0 before merging.

## Removing an environment

1. `gh api --method DELETE repos/:owner/:repo/environments/<name>`
2. `rm .github/environments/<name>.json`
3. `rm .github/rulesets/<branch>.json`
4. `rm .env.<name>` (local-only, already gitignored — but tidy up your machine)
5. Edit `.github/workflows/reusable-railway-deploy.yml`: drop `<branch>` from `branches` and
   remove the corresponding case.
6. Run `pnpm github:sync --check` to confirm.

## Why the invariant matters

A drift between any two dimensions silently breaks deploys:

- Branch / GH env mismatch → workflow targets an env that has no secrets → Zod-rejects on
  first request.
- `NODE_ENV` value missing → `env.config.ts` throws at boot with no meaningful message.
- GH env config missing → workflow runs but has no protection / secrets.

`pnpm github:sync --check` is the single source of truth: if that command is green,
every committed dimension matches and remote GitHub IaC has no reported drift.
