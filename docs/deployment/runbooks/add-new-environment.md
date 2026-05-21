# Runbook: add a new deployment environment

A "new environment" means another hosted target alongside `development` and `production` —
typically `staging` for pre-production validation. This runbook keeps the canonical 1:1
mapping intact across all dimensions.

## Canonical invariant

Every hosted environment must satisfy:

```
Git branch  ==  GitHub Environment  ==  NODE_ENV value
```

Plus the operator-local artefact:

```
.env.<environment>   (gitignored; created by `pnpm env:init`, pushed by `pnpm env:sync`)
```

| Dimension | Lives in |
| --------- | -------- |
| `NODE_ENV` enum value | `src/shared/config/env-schema.ts` |
| `.github/environments/<env>.json` | committed protection config |
| Branch ruleset | `.github/rulesets/<branch>.json` |
| Workflow case mapping | `.github/workflows/deploy-railway.yml` |
| GitHub Environment (secrets + variables) | live in GitHub UI (managed via `pnpm env:sync`) |
| `.env.<environment>` | repo root, **gitignored** (operator-local; source of truth for `env:sync`) |

`pnpm validate:env-consistency` enforces the three committed dimensions on every PR. CI
fails if any of them disagree.

## Existing hosted environments

| Branch | GitHub Environment | `NODE_ENV` |
| ------ | ------------------ | ---------- |
| `main` | `production`       | `production` |
| `dev`  | `development`      | `development` |

Non-hosted runtime modes (no branch, no GH env): `local`, `test`.

## First-time bootstrap

For an existing environment whose values have not been seeded into GitHub yet:

```bash
pnpm env:init                      # creates .env.development + .env.production
# Edit each file with real values
pnpm env:sync development          # push to GitHub
pnpm env:sync production
```

`env:sync` is idempotent — safe to re-run any time you change a value locally.

## Adding a new environment

> Example: adding `staging` deployed from a `staging` branch.

### 1. Confirm the `NODE_ENV` enum already lists the new value

If not, add it to `nodeEnvSchema` in `src/shared/config/env-schema.ts` first and run
`pnpm validate`.

### 2. Scaffold local + committed files

```bash
pnpm env:add staging --branch staging
```

This creates (idempotent — never overwrites existing files):

- `.env.staging` (local, **gitignored**) — copy of `.env.example`. Edit it with real values.
- `.github/environments/staging.json` (committed) — empty protection by default.
- `.github/rulesets/staging.json` (committed) — branch ruleset matching `dev` / `main`.

It also prints the exact next commands.

### 3. Fill in `.env.staging` with real values

Open `.env.staging` and replace placeholders with real `DATABASE_URL`, `REDIS_URL`, JWT
keypair, `SENTRY_DSN`, Railway token, etc. Leave optional integrations blank — `env:sync`
skips empty values.

### 4. Push to GitHub

```bash
pnpm env:sync staging --dry-run    # preview what will be pushed
pnpm env:sync staging              # push for real
```

`env:sync` creates the GitHub Environment and pushes every `KEY=VALUE` according to which
top-level half it sits in inside `.env.<environment>`:

- Anything under `# ### GitHub Secrets ### #` → `gh secret set`.
- Anything under `# ### GitHub Variables ### #` → `gh api .../variables`.

The file structure is the source of truth — no separate classifier file, no override lists.
The `env-schema-add` skill walks through which half + sub-section to pick when adding a new
env var.

### 5. Wire the workflow

Edit `.github/workflows/deploy-railway.yml`:

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
pnpm validate:env-consistency             # cross-dimension drift check
pnpm tool:sync-env-example                # .env.example <-> schema coverage
CONFIG=staging pnpm validate:github-env   # GH env <-> schema required keys
```

All three must exit 0 before merging.

## Removing an environment

1. `gh api --method DELETE repos/:owner/:repo/environments/<name>`
2. `rm .github/environments/<name>.json`
3. `rm .github/rulesets/<branch>.json`
4. `rm .env.<name>` (local-only, already gitignored — but tidy up your machine)
5. Edit `.github/workflows/deploy-railway.yml`: drop `<branch>` from `branches` and
   remove the corresponding case.
6. Run `pnpm validate:env-consistency` to confirm.

## Why the invariant matters

A drift between any two dimensions silently breaks deploys:

- Branch / GH env mismatch → workflow targets an env that has no secrets → Zod-rejects on
  first request.
- `NODE_ENV` value missing → `env.config.ts` throws at boot with no meaningful message.
- GH env config missing → workflow runs but has no protection / secrets.

The lint validator (`pnpm validate:env-consistency`) is the single source of truth: if
that command is green, every committed dimension matches.
