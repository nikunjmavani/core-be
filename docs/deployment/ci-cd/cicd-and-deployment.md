# CI/CD and Deployment

Single reference for what runs in CI, how deployment to Railway works, and **which tokens you need where**. Includes all deployment **Mermaid diagrams** (push → CI → deploy, release-please, secrets). Secrets are stored in **GitHub Environments** (development, production). See [setup.md](../../getting-started/setup.md) for local dev; [git-workflow.md](../../process/git-workflow.md) for branches and PRs.

> **Prerequisite:** Infrastructure must be set up before auto-deploy works. Use [setup-automation.md](../setup/setup-automation.md) (`pnpm setup:infra`) to provision Neon, Redis, Railway, GitHub secrets first.

---

## 1. Overview

```mermaid
flowchart TD
  PR[pull_request to main or dev] --> PRCI[PR CI]
  PRCI --> Lint[Lint]
  PRCI --> Typecheck[Typecheck]
  PRCI --> Unit[Unit tests]
  PRCI --> MigLint[Migration lint]
  PRCI --> BuildVerify[Build verify]
  PRCI --> Sec[Security scan]
  PRCI --> Contract[Contract + property]

  Merge[PR merge] --> Push[push to main or dev]
  Push --> PostMerge[Post-merge CI]

  PostMerge --> Commitlint[Commitlint]
  PostMerge --> ReleasePlease[Release Please]
  PostMerge --> Integration[Integration tests]
  PostMerge --> Docker[Docker Trivy GHCR]
  PostMerge --> Chaos[Chaos]
  PostMerge --> SBOM[SBOM artifact]
  PostMerge --> APIDocs[API docs]
  PostMerge --> SyncMain[Sync main into dev]

  Docker --> Deploy[Deploy via CD reusable]
  Integration --> Deploy
  Commitlint --> Deploy
  ReleasePlease --> Deploy

  Deploy --> Railway[Railway development or production]

  ReleasePlease --> ReleaseSBOM[Release SBOM attach]
```

- **PR CI** ([pr-ci.yml](../../../.github/workflows/pr-ci.yml)) runs on every **pull_request** to **main** and **dev**: seven parallel jobs (lint, typecheck, unit + global with `vitest --changed`, migration safety lint, TS + Docker build verify, security scan, contract + property). No Postgres/Redis and no GHCR push on PR.
- **Post-merge CI** ([post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)) is the **single post-merge pipeline** on push to `dev` or `main` (same jobs on both branches): commitlint, release-please, integration tests, Docker build + Trivy + GHCR push, chaos, SBOM artifact, API docs, sync main→dev (main only), Railway deploy, and release SBOM attachment when release-please publishes a release. Lint/typecheck/unit are **not** re-run — the same commit SHA already passed PR CI.
- **Deploy** runs inside Post-merge CI via reusable [cd.yml](../../../.github/workflows/cd.yml). Only the GitHub Environment differs: `dev` → **development**, `main` → **production**. Manual `workflow_dispatch` on CD remains for emergency redeploys. **When post-deploy API smoke passes, that environment is fully live** — the deploy job is the last gate before traffic.
- Release-please runs inside Post-merge CI on both channels (`main` stable, `dev` prerelease). When it publishes a GitHub Release in the same run, **Release SBOM** attaches CycloneDX to that release.

---

## 2. CI pipeline (what runs)

### PR lane ([pr-ci.yml](../../../.github/workflows/pr-ci.yml))

All jobs run **in parallel** (~2–3 min target). Caching: `actions/setup-node` with `cache: pnpm`, Vitest `node_modules/.vitest`, Docker BuildKit GHA cache scopes `core-be-api` / `core-be-worker`.

| Job | What |
| --- | ---- |
| **Lint** | `pnpm lint` (Biome) |
| **Typecheck** | `pnpm typecheck` |
| **Unit** | `vitest --project unit --project global --changed origin/{base}` (no DB) |
| **Migration lint** | `pnpm db:migrate:lint` (static migration safety) |
| **Build verify** | `pnpm build` + Docker API/worker build (`load: true`, no push, no Trivy) |
| **Security scan** | `pnpm deps:audit`, gitleaks, semgrep |
| **Contract + property** | `pnpm test:contract`, `pnpm test:property` |

### Post-merge lane ([post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml))

Runs on **push** to `main` / `dev` after merge. Does **not** re-run lint, typecheck, or unit tests.

| Job | When | What |
| --- | ---- | ---- |
| **Integration** | `src-code` or `ci-config` | Postgres + Redis → migrate → 3 Vitest DB shards + coverage gate |
| **Docker** | `src-code`, `docker`, or `ci-config` | Build + Trivy + `/health` smoke + push `ghcr.io/.../core-be-api:{sha}` (and `:latest` on `main`) |
| **Chaos** | `src-code` | Toxiproxy + `pnpm test:chaos` |
| **SBOM** | `src-code` | CycloneDX artifact (workflow artifact) |
| **API docs** | `src-code` or openapi paths | `pnpm docs:all`, Postman + Scalar publish |
| **Commitlint** | Every push | Conventional commit messages on the push |
| **Release Please** | Every push | Opens/updates release PR; may publish GitHub Release |
| **Sync main into dev** | Push to `main` only | Opens/updates automation PR to keep `dev` aligned |
| **Deploy** | Docker job succeeded + gates green | Reusable [cd.yml](../../../.github/workflows/cd.yml) → migrate → redeploy → `/health` → worker readiness → **`pnpm test:api-smoke`** → **fully live** |
| **Release SBOM** | Release Please published a release | CycloneDX SBOM attached to GitHub Release |

| Other | When | What |
| ----- | ---- | ---- |
| **PR Governance** | Every PR | Conventional title, labels, `.env` guard — [pr-governance.yml](../../../.github/workflows/pr-governance.yml) |
| **Docs lane** | PR touches `*.md` | markdownlint + lychee — [pr-docs-lane.yml](../../../.github/workflows/pr-docs-lane.yml) |

Index: [.github/README.md](../../../.github/README.md). Required PR check names: [branch-protection.md](branch-protection.md).

**Path filters (docs-only PRs):** [pr-ci.yml](../../../.github/workflows/pr-ci.yml) skips all PR CI jobs when the diff is markdown/docs only. Markdown PRs also trigger [pr-docs-lane.yml](../../../.github/workflows/pr-docs-lane.yml).

---

## 3. Branch-to-environment mapping

```mermaid
flowchart LR
  subgraph branches [Git branches]
    dev_b[dev]
    main_b[main]
  end

  subgraph gh_envs [GitHub Environments]
    dev_env[development]
    prod_env[production]
  end

  subgraph railway [Railway]
    dev_svc[dev service]
    prod_svc[production service]
  end

  dev_b --> dev_env
  dev_b --> dev_svc
  main_b --> prod_env
  main_b --> prod_svc
```

| Branch | GitHub environment | Railway service |
| ------ | ------------------ | --------------- |
| dev    | development        | Development     |
| main   | production         | Production      |

Deploy workflow: reusable [cd.yml](../../../.github/workflows/cd.yml) called from **Post-merge CI** (or manual `workflow_dispatch` for emergency redeploy).

**Branch protection:** Which CI jobs must be required on **`main`** and **`dev`**, plus committed ruleset JSON and apply steps — see [branch-protection.md](branch-protection.md).

---

## 4. Release and versioning (release-please)

Release-please turns **conventional commits** into a **release PR** (CHANGELOG + version bump in `package.json`). When you merge that PR, it creates the **GitHub Release** and tag. No npm publish is run (the package is private). We use the maintained [googleapis/release-please](https://github.com/googleapis/release-please) action.

There are **two release channels** — each tracks its own version via a dedicated manifest, so they never collide:

| Channel        | Branch | Tag style      | Config file                                                                               | Manifest file                                                                                 | Changelog          |
| -------------- | ------ | -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| **Stable**     | `main` | `v2.1.0`       | [.github/release-please/config.json](../../../.github/release-please/config.json)         | [.github/release-please/manifest.json](../../../.github/release-please/manifest.json)         | `CHANGELOG.md`     |
| **Prerelease** | `dev`  | `v2.1.0-dev.0` | [.github/release-please/config.dev.json](../../../.github/release-please/config.dev.json) | [.github/release-please/manifest.dev.json](../../../.github/release-please/manifest.dev.json) | `CHANGELOG-dev.md` |

The dev config sets `prerelease: true` + `prerelease-type: "dev"` and writes its own `CHANGELOG-dev.md`, so a `dev → main` promotion never collides with main's `CHANGELOG.md`. Both channels publish GitHub Releases (`release: published`), so [release-sbom.yml](../../../.github/workflows/release-sbom.yml) attaches a CycloneDX SBOM in either case.

> **`package.json` version on `dev`** — release-please's `node` release-type also bumps `package.json` on each dev release (e.g. `2.1.0-dev.0`). When you eventually promote `dev → main`, expect a `package.json` merge conflict on the release-PR line; resolve it by **keeping `main`'s version**. The next release-please run on `main` then bumps to the matching stable version.

Local commits are validated by **commitlint** via [.husky/commit-msg](../../../.husky/commit-msg); pushes to **main** and **dev** run **Commitlint** inside [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml).

**Branch protection:** Require the CI and PR-check jobs listed in [branch-protection.md](branch-protection.md); apply policies via GitHub Rulesets using [`.github/rulesets/`](../../../.github/rulesets/) or the GitHub UI. On **`main`**, use **Squash and merge** only with the default squash message taken from the PR title so every commit stays conventional (PR checks validate the title; Post-merge **Commitlint** validates pushes).

| What         | Where                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Runs on**  | Push to **main** (stable) and **dev** (prerelease) — job inside [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml) |
| **Token**    | Built-in **`github.token`** (no extra GitHub Environment secret required) |

### 4.1 Release and deploy flow (feature → production)

```mermaid
flowchart TB
  subgraph develop [Develop]
    Feature[Feature branch]
    PR[Pull request]
    CI[CI: quality, test, security]
    Feature --> PR --> CI
  end

  subgraph merge [Merge]
    DevMerge[Merge to dev]
    MainMerge[Merge to main]
  end

  subgraph on_main [On push to main]
    ReleasePlease[Release-please: release PR]
    MergeReleasePR[Merge release PR]
    TagRelease[Tag and GitHub Release]
    DeployProd[Deploy to production]
    ReleasePlease --> MergeReleasePR --> TagRelease
    MainMerge --> ReleasePlease
    MainMerge --> DeployProd
  end

  CI --> DevMerge
  CI --> MainMerge
  DevMerge --> DeployDev[Deploy to dev]
```

- **Feature → PR → CI:** Every PR runs quality, tests, and security. PR title must follow conventional commits (validated by PR checks).
- **Merge to dev/main:** Each branch maps to an environment; push triggers the corresponding deploy workflow (GitHub environment secrets + Railway).
- **On main and dev:** **Commitlint** validates commit messages on each push. **Release-please** opens or updates a **release PR** (CHANGELOG + version bump) per channel — `main` produces stable releases, `dev` produces pre-releases (`-dev.N`). Merging that PR creates the GitHub Release and tag for that channel; the SBOM workflow attaches a CycloneDX SBOM. The same push to the branch also triggers **deploy to** the matching environment.

**Production path (steps):**

1. Merge to `main` (e.g. from a release PR).
2. Release-please creates or updates the release PR on push to `main`.
3. Merge the release PR when ready → stable GitHub Release + tag (`v2.x.y`) → `release-sbom.yml` attaches the SBOM.
4. CI `docker-build` job on `main` Trivy-scans and pushes `ghcr.io/<owner>/<repo>/core-be-api` and `core-be-worker` (tags `:sha` and `:latest`).
5. Deploy workflow runs on push to `main` (validate env → resolve GHCR images → migrate → `railway redeploy --image` → `/health` → worker readiness → `pnpm test:api-smoke` on the Railway API URL).
6. Optional load check: `pnpm load:health` against the deployed base URL.

**Development path (steps):** identical to production but on the `dev` branch, with a few differences:

1. Merge to `dev` (e.g. from a feature PR).
2. Release-please creates or updates the **dev release PR** on push to `dev` (`.github/release-please/config.dev.json` + `.github/release-please/manifest.dev.json`).
3. Merge the dev release PR when ready → **prerelease** GitHub Release + tag (`v2.x.y-dev.N`) → `release-sbom.yml` attaches the SBOM.
4. CI `docker-build` job on `dev` Trivy-scans and pushes `ghcr.io/<owner>/<repo>/core-be-api` and `core-be-worker` (SHA-tagged only — `:latest` is reserved for `main`).
5. Deploy workflow runs on push to `dev` (validate env → resolve GHCR images by SHA → migrate → `railway redeploy --image`) against the **development** GitHub Environment.

**Hotfix:** Branch from `main` (`hotfix/*`), conventional commit, PR into `main`. Merge triggers production deploy and release-please on the same push. Branch strategy: [git-workflow.md](../../process/git-workflow.md).

### Verify release-please after changing bootstrap config

On GitHub, after merging a change that touches release-please files:

1. Open **Actions** → **Post-merge CI** → confirm **Release Please** succeeded on **both** `main` and `dev`.
2. Confirm a **release-please** PR exists or is updated when there are new conventional commits since the channel's manifest version (or that the workflow completes with no release until the next qualifying commit). Each channel produces its own PR.
3. Ensure git tag **`v1.0.0`** exists at the historical 1.0.0 commit if you rely on tag-based archaeology; create it once if absent.
4. After you **merge** an automated release PR, confirm the matching **GitHub Release** + tag exist and that `CHANGELOG.md` / `package.json` were updated by the bot — `main` → stable `v2.x.y`, `dev` → prerelease `v2.x.y-dev.N`.

---

## 5. Deploy flow (per environment)

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant GH as GitHub Actions
  participant GHCR as GHCR
  participant Railway as Railway

  Dev->>GH: Push to main
  GH->>GH: CI docker-build (build, Trivy, push)
  GH->>GHCR: core-be-api:sha, core-be-worker:sha
  Dev->>GH: CI success triggers deploy
  GH->>GH: validate:github-env, db:migrate
  GH->>GH: Resolve GHCR image refs (commit SHA or secrets)
  GH->>Railway: railway variable set + redeploy --image (API + worker)
  Railway->>GHCR: Pull scanned image
  Railway-->>GH: Deploy success
```

Steps in each deploy workflow:

1. Checkout code, install dependencies (migrations only — no app `pnpm build`).
2. Run `pnpm validate:github-env` against the GitHub environment.
3. **Resolve scanned CI images from GHCR** — default `ghcr.io/<owner>/<repo>/core-be-api:<commit-sha>` and `core-be-worker:<commit-sha>`; optional secrets **`GHCR_API_IMAGE`** / **`GHCR_WORKER_IMAGE`** override (digest or tag).
4. Run `pnpm db:migrate`, install Railway CLI, sync app env vars with `railway variable set`.
5. Deploy API and worker with `railway redeploy --service … --image …` (no `railway up` / source build on Railway).

**GHCR images (CI):** On push to **`main`**, the reusable [docker-build-verify.yml](../../../.github/workflows/reusable/docker-build-verify.yml) job builds API + worker images, runs Trivy (CRITICAL/HIGH, `exit-code: 1`), then pushes to GHCR. PRs build and scan only (no push).

**Railway pull access:** Each Railway service must be allowed to pull from `ghcr.io` (package visibility + deploy token or linked registry). Images are public within the org or use Railway’s registry credentials for private GHCR packages.

**Optional GitHub environment secrets:**

| Secret              | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `GHCR_API_IMAGE`    | Override API image ref (e.g. digest-pinned `ghcr.io/owner/repo/core-be-api@sha256:…`) |
| `GHCR_WORKER_IMAGE` | Override worker image ref                                                             |

**Variables synced to Railway on deploy** (when present in GitHub environment secrets):

`DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `ALLOWED_ORIGINS`, `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`, `FRONTEND_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILE_SAMPLE_RATE`, `AUDIT_RETENTION_DAYS`, `AUTH_SESSION_RETENTION_DAYS`, `NODE_OPTIONS`, `DEPLOYMENT_TOTAL_REPLICA_COUNT`, `DEPLOYMENT_API_REPLICA_COUNT`, `DEPLOYMENT_WORKER_REPLICA_COUNT`, `DATABASE_POOL_MAX`, `POSTGRES_RESERVED_CONNECTIONS`, `POSTGRES_MAX_CONNECTIONS`.

Set **`DEPLOYMENT_TOTAL_REPLICA_COUNT`** to `api_replicas + worker_replicas` on **both** Railway API and worker services (production **required** — startup fails without it). You can use **`DEPLOYMENT_API_REPLICA_COUNT`** and **`DEPLOYMENT_WORKER_REPLICA_COUNT`** instead when split counts are clearer. Optional **`POSTGRES_MAX_CONNECTIONS`** when `SHOW max_connections` is misleading behind a pooler. See [resource-limits.md](../runbooks/resource-limits.md).

Optional on Railway/GitHub only if overriding app default: **`TOMBSTONE_RETENTION_DAYS`** (defaults to **90** in the env schema). **`NODE_OPTIONS`** (for example `--max-old-space-size=<MiB>` for heap limits) is optional and is **not** part of the Zod env schema (Node reads it at process start) — see [resource-limits.md](../runbooks/resource-limits.md).

`RAILWAY_TOKEN` and `RAILWAY_SERVICE_ID` are used by the CLI only; they are not written to Railway as app env vars.

**Validate GitHub env:** Run `pnpm validate:github-env` (or `CONFIG=production pnpm validate:github-env`) to ensure all required vars from `.env.example` exist in the target GitHub environment. Deploy workflows use `environment: development|production` so secrets are scoped per env.

**Not synced to Railway by CD today:**

| Item                    | Notes                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integration secrets** | `pnpm setup:infra` can push `RESEND_*`, `STRIPE_*`, `OAUTH_*`, `S3_*`, etc. to GitHub via [build-env-vars.ts](../../../tooling/setup/build-env-vars.ts), but `cd.yml` does **not** call `railway variable set` for those keys. Set them on Railway once or add them to the CD variable loop. |

---

## 6. Adding a new env var

Use the **env-schema-add** skill (`.cursor/skills/env-schema-add/SKILL.md`) — it
walks through the Secret-vs-Variable decision and the section placement in
`.env.example`. Summary:

1. **Add the Zod field** to [src/shared/config/env-schema.ts](../../../src/shared/config/env-schema.ts).
   Mark `.optional()` if the runtime can work without it; add `.default()` for
   sensible operational defaults.
2. **Add `KEY=placeholder` to [.env.example](../../../.env.example)** under the
   correct top-level half (`# GitHub Secrets ###` or `# GitHub Variables ###`)
   and an existing sub-section. The half a key sits in IS its classification —
   `pnpm github:sync` reads the structure directly.
3. **Verify schema ↔ template parity** with `pnpm tool:sync-env-example`
   (`--fix` will append commented placeholders for missing keys).
4. **Update operator env files** manually. Existing `.env.<environment>` files
   are not overwritten, so add the new key under the same half + sub-section
   without discarding real values.
5. **Edit `.env.<environment>`** with the real value(s) for each environment
   you have access to, then push:

   ```bash
   pnpm github:sync development --dry-run     # preview the [secret] / [variable] column
   pnpm github:sync development               # push
   pnpm github:sync production --dry-run
   pnpm github:sync production
   ```

6. **Add the key to [cd.yml](../../../.github/workflows/cd.yml)**
   if it must be synced through to the Railway service variables step.
7. **Paste the "Environment variable changes" snippet** printed by
   `pnpm tool:sync-env-example` into the PR description so reviewers and the
   deploy workflow know what was added/removed.

Full lifecycle (rename, remove, validation matrix, troubleshooting):
**[environment-variables.md](../runbooks/environment-variables.md)**.

---

## 7. Where you need which token (reference)

All tokens stay **out of the repo**. Local uses `.env.<environment>`
(gitignored, generated by `pnpm github:sync` from `.github/sync.config.json`); CI/deploy uses **GitHub
Environments** (populated by `pnpm github:sync <environment>`).

```mermaid
flowchart TB
  subgraph local [Local]
    A1[".env.&lt;environment&gt; at project root\n(gitignored; pnpm github:sync)"]
    A2["pnpm dev / dev:worker\n(loader picks .env.${NODE_ENV})"]
    A1 --> A2
  end

  subgraph ci_env [CI tests]
    B1["Workflow env in ci.yml"]
    B2["Ephemeral Postgres + Redis"]
    B1 --> B2
  end

  subgraph deploy_env [Deploy]
    C1["GitHub environment secrets"]
    C2["Deploy workflow"]
    C3["railway variable set + redeploy --image"]
    C1 --> C2 --> C3
  end
```

```mermaid
flowchart TB
  subgraph repo [Repository]
    Code[Source code]
    EnvExample[.env.example only]
  end

  subgraph github [GitHub Actions]
    PRGuard[PR .env guard]
    Gitleaks[Gitleaks]
    Semgrep[Semgrep]
  end

  subgraph gh_secrets [GitHub environment secrets]
    AppSecrets[App env vars]
  end

  DeployWF[Deploy workflows] --> gh_secrets
  PRGuard --> repo
  Gitleaks --> repo
  Semgrep --> repo
```

| Where                                                        | What                                                                                                                                                                                                                                                                          | Used for                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Local** (`.env.<environment>` at project root, gitignored) | `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (RS256, required), `SECRETS_ENCRYPTION_KEY` (64 hex), `ALLOWED_ORIGINS`. `JWT_SECRET` optional deprecated no-op. Optional: Resend, Stripe, OAuth, S3, Sentry (see [.env.example](../../../.env.example))    | `pnpm dev` / `pnpm dev:worker` — loader reads `.env.${NODE_ENV}`. **Never commit any `.env.*` other than `.env.example`.** |
| **GitHub** → Environments (development, production)          | All keys from `.env.<environment>`, classified by section: anything under `# GitHub Secrets ###` becomes a Secret; anything under `# GitHub Variables ###` becomes a Variable. Plus **RAILWAY_TOKEN**, **RAILWAY_SERVICE_ID**, **RAILWAY_WORKER_SERVICE_ID** (workflow-only). | Deploy workflows. Populated by `pnpm github:sync <environment>` — idempotent, overwrites in place.                         |
| **Railway**                                                  | Create **project token** → put in GitHub env as **RAILWAY_TOKEN**. Create **service(s)** → copy **Service ID** into GitHub env as **RAILWAY_SERVICE_ID** / **RAILWAY_WORKER_SERVICE_ID**.                                                                                     | Token and service IDs are stored in GitHub Environments only.                                                              |

**Summary:**

- **Local:** `pnpm github:sync` → edit `.env.<environment>` → `pnpm dev` / `pnpm dev:worker`.
- **GitHub:** `pnpm github:sync <environment>` pushes every key under the right section header. Re-run any time you change a value locally.
- **Railway:** Create token and service(s); deploy workflow reads them from the GitHub Environment.

---

## 8. First-time setup checklist

Use this once to get CI and deployment working.

### 8.1 GitHub Environments

- [ ] Create environments **development** and **production** in the repo: Settings → Environments → New environment.
- [ ] Run `pnpm setup:infra` — it provisions Neon, Redis, Railway, etc., and pushes all secrets to GitHub (repository + environment secrets).
- [ ] Or manually: add **RAILWAY_TOKEN**, **RAILWAY_SERVICE_ID**, **DATABASE_URL**, **REDIS_URL**, **JWT_PRIVATE_KEY**, **JWT_PUBLIC_KEY**, **ALLOWED_ORIGINS** (and other app vars) to each environment’s Environment secrets.

### 8.2 Railway

- [ ] Create a **Railway project** (or setup does this).
- [ ] Create at least one **service** for the API per environment.
- [ ] In Railway Project → **Settings → Tokens**, create a token → add as **RAILWAY_TOKEN** in GitHub environments.
- [ ] Copy each **Service ID** → add as **RAILWAY_SERVICE_ID** in the corresponding GitHub environment.

After this, pushes to **dev** and **main** will run the deploy workflow. No keys or tokens are committed; they stay in GitHub.

---

## 9. Setup via CLI (Railway + GitHub)

### 9.1 Railway CLI

**Install**

```bash
npm i -g @railway/cli
# or: brew install railway
```

**One-time login** — `railway login` (opens browser).

**Create project and service**

```bash
railway init
railway add
railway status --json   # copy service ID
```

**Create project token** — Railway dashboard → Project → Settings → Tokens → Create token. Add to GitHub environment as **RAILWAY_TOKEN**.

### 9.2 GitHub CLI

**Install**

```bash
brew install gh
```

**Auth**

```bash
gh auth login
```

**Set environment secrets** (manual, if not using setup)

```bash
gh secret set RAILWAY_TOKEN --env development --body "paste-token"
gh secret set RAILWAY_SERVICE_ID --env development --body "paste-service-id"
gh secret set DATABASE_URL --env development --body "postgresql://..."
# etc.
```

---

## 10. Quick reference

| Step                   | Railway                                           | GitHub                                                                          |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Install                | `npm i -g @railway/cli` or `brew install railway` | `brew install gh`                                                               |
| Auth                   | `railway login`                                   | `gh auth login`                                                                 |
| Create project/service | `railway init` then `railway add`                 | Create environments development, production in repo Settings                    |
| Get service ID         | `railway status --json`                           | —                                                                               |
| Set secrets            | Use dashboard for project token                   | `gh secret set NAME --env development --body "value"` or run `pnpm setup:infra` |

No Doppler. All deploy secrets live in GitHub Environments.
