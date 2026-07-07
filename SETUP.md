# Setup — from clone to running

End-to-end guide to get **core-be** running locally or on managed cloud infrastructure. Two paths:

- **[Local development](#local-development)** — run everything on your machine against Docker Postgres + Redis. Best for day-to-day development. One command: `pnpm setup:local`.
- **[Cloud infrastructure](#cloud-infrastructure-setupinfra)** — provision managed providers (Neon, Redis, S3, Sentry, Railway, GitHub) for shared/hosted environments. One command: `pnpm setup:infra`.

**Related:** [README.md](README.md) · [CLAUDE.md](CLAUDE.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/README.md](docs/README.md) · [cicd-and-deployment.md](docs/deployment/ci-cd/cicd-and-deployment.md) · [credentials-and-env.md](docs/integrations/credentials-and-env.md)

---

## Prerequisites

| Requirement     | Notes                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| **Node.js 24+** | Pinned in `package.json` → `engines.node` and `.nvmrc`.                                                        |
| **pnpm 11+**    | `corepack enable && corepack prepare pnpm@latest --activate`                                                   |
| **Docker**      | Required for local Postgres + Redis (`pnpm compose:up`). Start Docker Desktop / OrbStack before `setup:local`. |
| **Git**         | To clone the repository.                                                                                       |

**Switch to Node 24** (the repo does not enforce one manager):

| Tool      | Command                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| **nvm**   | `nvm install` then `nvm use` (reads `.nvmrc`)                                             |
| **fnm**   | `fnm install` then `fnm use` (reads `.nvmrc` when `use-on-cd` is set)                     |
| **n**     | `n 24` — open a new terminal and verify `node -v`; `n auto` also works from the repo root |
| **Volta** | `volta install node@24`                                                                   |

```mermaid
flowchart LR
  A[Clone + pnpm install] --> B{Path?}
  B -->|Local dev| C[pnpm setup:local]
  B -->|Cloud infra| D[pnpm setup:infra]
  C --> E[API on :3000 + worker]
  D --> F[Migrate + seed via CD] --> E
```

---

## 1. Clone and install

```bash
git clone <repo-url>
cd core-be
pnpm install
```

---

## Local development

### Option A — one command (recommended)

`pnpm setup:local` is an idempotent, re-run-safe bootstrap. It runs: preflight checks → `pnpm install` (if needed) → scaffold `.env.development` + `.env.local` → start Docker Postgres + Redis → `pnpm db:migrate` → optional seed → optional CodeGraph index → start `pnpm dev`.

```bash
pnpm setup:local                             # bootstrap + start the API
pnpm setup:local --seed minimal              # also seed minimal data
pnpm setup:local --seed full --with-worker   # full demo seed + worker process
pnpm setup:local --no-start                  # bootstrap only, don't start dev
pnpm setup:local --check                     # preflight only, no mutations
```

What it creates automatically on first run:

- **`.env.development`** — seeded from `.env.example` with a freshly generated RS256 JWT keypair (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`) and `SECRETS_ENCRYPTION_KEY`. Existing files are never overwritten.
- **`.env.local`** — localhost override pointing `DATABASE_URL` / `REDIS_URL` at the Docker Compose stack (`postgresql://core:core@localhost:5432/core`, `redis://localhost:6379`). Use `--force-env-local` to rewrite it.

Useful flags: `--skip-deps`, `--skip-docker`, `--skip-migrate`, `--skip-codegraph`, `--with-toxiproxy`.

When it finishes, the API is at `http://localhost:3000` (`/livez`, `/readyz`).

### Option B — manual steps

```bash
# 1. Environment files
pnpm github:sync
$EDITOR .env.development        # fill DATABASE_URL, REDIS_URL, JWT_* keypair, SECRETS_ENCRYPTION_KEY

# 2. Start Postgres + Redis and wait until ready
pnpm compose:up
pnpm compose:wait               # exits non-zero if Postgres never becomes healthy

# 3. Apply migrations
pnpm db:migrate

# 4. (Optional) seed data
pnpm db:seed                    # minimal
pnpm db:seed:full               # full demo (demo@example.com / DemoPassword123!)

# 5. Run the API and worker (two terminals)
pnpm dev                        # API at http://localhost:3000
pnpm dev:worker                 # BullMQ workers (mail, webhook, notification, retention)
```

Optional env for the wait step: `WAIT_FOR_POSTGRES_ATTEMPTS` (default `60`), `WAIT_FOR_POSTGRES_INTERVAL_SECONDS` (default `1`).

---

## Environment variables

Env files live at **project root only**. There is exactly one committed template — `.env.example` — and one gitignored file per environment.

| File                 | Status         | Purpose                                                                            |
| -------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `.env.example`       | committed      | Single template; every schema key with its section and sub-section                 |
| `.env.local.example` | committed      | Template for the local override; copy to `.env.local` for Docker dev               |
| `.env.development`   | **gitignored** | Local + dev-environment values; source of truth for `pnpm github:sync development` |
| `.env.production`    | **gitignored** | Production values; source of truth for `pnpm github:sync production`               |
| `.env.local`         | **gitignored** | Machine-specific override; wins over `.env.<NODE_ENV>` for local dev only          |

**Minimum required:** `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (RS256 PEM pair), `SECRETS_ENCRYPTION_KEY` (64 hex chars).

The runtime loader reads `.env.${NODE_ENV}` (defaults to `.env.development`) then applies `.env.local` as an override (non-production only). This lets you point `DATABASE_URL` / `REDIS_URL` at Docker without editing `.env.development`.

`.env.example` is split into two halves (`# GitHub Secrets`, `# GitHub Variables`). The half a key sits in is its classification — `pnpm github:sync <environment>` pushes each half to GitHub Environment secrets or variables. See [credentials-and-env.md](docs/integrations/credentials-and-env.md) for per-provider credential acquisition and [environment-variables.md](docs/deployment/runbooks/environment-variables.md) for the full lifecycle.

---

## Cloud infrastructure (`setup:infra`)

Use this to provision managed providers for a shared or hosted environment. Auto-deploy on push to `main` expects this infrastructure to already exist.

```bash
pnpm setup --init              # optional: interactive config → setup.config.json + .setup/.setup-credentials template
$EDITOR .setup/.setup-credentials             # fill provider API keys (each line has a comment with the URL)
pnpm setup:infra:preview       # show providers + where to get each token (no API calls)
pnpm setup:infra               # provision Neon, Redis, S3, Sentry, Railway, GitHub (double confirm)
pnpm setup:infra:check         # health-check provisioned resources
pnpm setup:infra:status        # what is provisioned vs missing per environment
```

Notes:

- **Config** lives in `tooling/setup/setup.config.json` (committed); **secrets** in `.setup/.setup-credentials` at root (gitignored).
- `setup:infra` does **not** run migrations or seeds — those run via the CD pipeline.
- After provisioning it writes `.env.<environment>` files you can push to GitHub Environment secrets. Regenerate anytime with `pnpm setup:infra:export-env`.
- `setup:infra:delete` only prints manual-delete dashboard URLs — it never deletes resources.

Full detail: [setup-automation.md](docs/deployment/setup/setup-automation.md) · [setup-token-instructions.md](docs/deployment/setup/setup-token-instructions.md)

---

## 2. Verify it's running

```bash
curl http://localhost:3000/livez     # liveness
curl http://localhost:3000/readyz    # readiness (DB + Redis)
```

Optional dashboards (when enabled via env flags):

- API reference (Scalar): `http://localhost:3000/api/reference` (`ENABLE_API_REFERENCE`)
- Queue dashboard: `http://localhost:3000/admin/queues` (`ENABLE_QUEUE_DASHBOARD`)

End-to-end gate (migrate → seed → live API smoke → validate):

```bash
pnpm verify:base
```

For manual API checks after full seed see [api-testing.md](docs/getting-started/api-testing.md).

---

## 3. Git workflow

Long-lived branch: **`main`** (single trunk). Short-lived branches use `feature/`, `fix/`, `hotfix/` prefixes off `main`.

Full detail (branch naming, PR flow, hotfixes, protected branches): [trunk-based-workflow.md](docs/process/trunk-based-workflow.md).

---

## 4. Testing

Tests live under `src/tests/` (cross-cutting) and co-located `__tests__/` inside each domain. See [CLAUDE.md](CLAUDE.md) § Testing for the full layout.

| Category                | Command                 | When to run                                         |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| **Unit**                | `pnpm test:unit`        | Fast feedback before commit; no DB needed           |
| **Integration**         | `pnpm test:integration` | Before pushing; requires Postgres + Redis           |
| **E2E / domain**        | `pnpm test:e2e`         | Full domain flows; run with `pnpm test`             |
| **Contract (outbound)** | `pnpm test:contract`    | Mocked Stripe / Resend / S3; runs in CI quality job |
| **Security**            | `pnpm test:security`    | Auth, JWT, CORS, rate-limiting; before release      |
| **Performance**         | `pnpm test:performance` | When changing queries or concurrency                |
| **Smoke (health)**      | `pnpm load:health`      | Quick sanity after deploy; no auth needed           |
| **Load (stress)**       | `pnpm load:stress`      | Before release or after infra changes               |

**When to run:**

- Before commit → `pnpm validate && pnpm test:unit`
- Before PR → `pnpm validate && pnpm test`
- Before release → add `pnpm test:security`, `pnpm load:stress`
- After deploy → `pnpm load:health` or `GET /readyz`

Full k6 scenarios: [load-testing.md](docs/reference/testing/load-testing.md).

### Running a live server for a frontend / loopback E2E suite

The tiers above are **in-process** (`fastify.inject()`) and self-configure — the Vitest
harness (`NODE_ENV=test`) already relaxes the hardened boot guards and rate-limit caps, and
CI does the same, so **no manual env is needed for `pnpm test*` or CI**.

A **live server** is different: when an external suite drives a real core-be over loopback —
e.g. the **core-fe Playwright E2E** suite, which boots `pnpm dev` on `:3000` and hits it as
a browser client — the process runs under `NODE_ENV=development` and enforces the production
defaults unless told otherwise. Set these in **`.env.development`** (the gitignored dev file
that `pnpm setup:local` scaffolds from `.env.example` — **not** a plain `.env`, **not**
`.env.local`, **not** ad-hoc shell prefixes; keep the pair below with the values you need):

| Env var (in `.env.development`)                               | Set to                                              | Why the live server needs it                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_RELAXED_CAPS`                                     | `true`                                              | Public-auth routes (`send-code`, login) default to **5 req/min per IP** (`STRICT_PUBLIC_RATE_LIMIT` / `STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS` in `src/shared/middlewares/rate-limit/rate-limit-presets.constants.ts`). A loopback E2E suite floods that → `429 send-code failed` and every authenticated flow fails. `true` lifts each cap to 5000. A schema refine keeps it **false in production**. |
| `DATABASE_TLS_ENFORCED`                                       | `false`                                             | Local Docker Postgres is plaintext; `assertDatabaseTlsVerification` is fail-closed for hosted deployments only (its warn-path explicitly accepts local Docker).                                                                                                                                                                                                                                            |
| `DATABASE_RLS_SAFETY_ENFORCED`                                | `false`                                             | The Docker `core` role is a superuser / `BYPASSRLS`; `assertDatabaseRoleRlsSafety` is fail-closed for hosted deployments only.                                                                                                                                                                                                                                                                             |
| `PERSONAL_ORGANIZATION_ENABLED` / `TEAM_ORGANIZATION_ENABLED` | match the mode under test (**at least one `true`**) | Selects the deployment mode (B2C / B2B / hybrid) the FE suite exercises. See [personal-vs-team-organizations.md](docs/reference/architecture/personal-vs-team-organizations.md).                                                                                                                                                                                                                           |

The committed **[`.env.example`](.env.example)** already ships all four keys with these
local values and the same production-safety notes — a fresh `.env.development` inherits them.
This section only matters if you've hardened your local file or run the server outside
`pnpm setup:local`. See also the rate-limit posture in
[authentication.md](docs/reference/security/authentication.md) and the flag
model in [environment-variables.md](docs/deployment/runbooks/environment-variables.md).

#### Why these live in `.env.development`, not a shell prefix

Set the flags in the file — **never** pass them inline on the command line
(`DATABASE_TLS_ENFORCED=false … pnpm dev`) and never as a plain `.env` / `.env.local`:

- **They are non-secret local-dev flags** (booleans, no keys or tokens), so they belong in
  `.env.development` — the repo-owner-maintained dev file — where the local-safety decision is
  made **once**, on the record, by a human. There is nothing sensitive to keep out of the file.
- **An automated agent cannot boot the server with these flags on the command line.** A
  coding agent's safety classifier reads an inline `DATABASE_TLS_ENFORCED=false
DATABASE_RLS_SAFETY_ENFORCED=false pnpm dev` as "disarm TLS / RLS" and **blocks** it, and the
  agent must not self-grant a permission rule to tunnel around that guard. Pre-setting the
  flags in `.env.development` removes the bypass flags from the command entirely: boot is a
  plain `pnpm dev` — nothing for the classifier to flag, no permission prompt, the agent just
  runs. So do not ask an agent to boot core-be by passing these flags on the CLI.
- **The production guardrail is unaffected.** `src/shared/config/env-schema.ts` pins
  `RATE_LIMIT_RELAXED_CAPS=false` and keeps the DB TLS / RLS guards enforced in production via a
  schema refine that rejects the loosened value there. Setting them false in `.env.development`
  only loosens the **local Docker** stack; a deployed `.env` omits them and stays hardened.

---

## 5. CI/CD and deployment

Everything in one place: [cicd-and-deployment.md](docs/deployment/ci-cd/cicd-and-deployment.md)

Covers: what runs in CI, branch-to-environment mapping (`dev` → development, `main` → production), deploy flow, which token goes where, and first-time setup checklist.

---

## 6. Common commands

| Goal                  | Command                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Local run (manual)    | `pnpm compose:up` → `pnpm compose:wait` → `pnpm db:migrate` → `pnpm dev` + `pnpm dev:worker` |
| Fast feedback         | `pnpm test:unit`                                                                             |
| Before PR             | `pnpm validate && pnpm test` (full gate: `pnpm ci:local`)                                    |
| Stop local stack      | `pnpm compose:down`                                                                          |
| Load-test credentials | `pnpm tool:load-test-credentials` (server + full seed running)                               |
| List every script     | `pnpm run`                                                                                   |

---

## 7. Dependency upgrades (maintainers)

- Run **`pnpm deps:audit`** regularly; address findings with safe updates or `overrides` in `pnpm-workspace.yaml`.
- Run **`pnpm outdated`** locally or rely on weekly Dependabot PRs (see [`.github/dependabot.yml`](.github/dependabot.yml)).
- Every Dependabot PR needs human review per branch protection. When CI fails on a Dependabot PR, [`.github/workflows/dependabot-ci-triage.yml`](.github/workflows/dependabot-ci-triage.yml) opens a triage issue.
- **Major upgrades** (e.g. Zod 3 → 4) touch most DTO/validator code; schedule as a dedicated migration, not mixed into routine batches.

---

## Troubleshooting

- **Docker daemon not reachable** — start Docker Desktop / OrbStack, then re-run.
- **Port 3000 in use** — stop the other process or set `PORT` in `.env.local`.
- **Postgres never becomes ready** — tune `WAIT_FOR_POSTGRES_ATTEMPTS` / `WAIT_FOR_POSTGRES_INTERVAL_SECONDS`, or check `pnpm compose:up` logs.
- **Missing env vars on boot** — ensure `DATABASE_URL`, `REDIS_URL`, the JWT keypair, and `SECRETS_ENCRYPTION_KEY` are set in `.env.development` (or `.env.local`).
