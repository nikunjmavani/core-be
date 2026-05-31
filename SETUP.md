# Setup — from clone to running

End-to-end guide to get **core-be** running, from cloning the repository to a live API and worker. Two paths are covered:

- **[Local development](#local-development)** — run everything on your machine against Docker Postgres + Redis. Best for day-to-day development. One command: `pnpm setup:local`.
- **[Cloud infrastructure](#cloud-infrastructure-setupinfra)** — provision managed providers (Neon, Redis, S3, Sentry, Railway, GitHub) for shared/hosted environments. One command: `pnpm setup:infra`.

For the canonical reference docs see [docs/getting-started/setup.md](docs/getting-started/setup.md) and [docs/deployment/setup/setup-automation.md](docs/deployment/setup/setup-automation.md).

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 24+** | Pinned in `package.json` → `engines.node` and `.nvmrc`. Switch with `nvm use` / `fnm use` / `n 24` / `volta install node@24`. |
| **pnpm 11+** | Enable via `corepack enable && corepack prepare pnpm@latest --activate`. |
| **Docker** | Required for local Postgres + Redis (`pnpm compose:up`). Start Docker Desktop / OrbStack before `setup:local`. |
| **Git** | To clone the repository. |

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

If your shell is not on Node 24 yet, switch first (e.g. `nvm use`, which reads `.nvmrc`).

---

## Local development

### Option A — one command (recommended)

`pnpm setup:local` is an idempotent, re-run-safe bootstrap. It runs: preflight checks → `pnpm install` (if needed) → scaffold `.env.development` + `.env.local` → start Docker Postgres + Redis → `pnpm db:migrate` → optional seed → optional CodeGraph index → start `pnpm dev`.

```bash
pnpm setup:local                      # bootstrap + start the API
pnpm setup:local --seed minimal       # also seed minimal data
pnpm setup:local --seed full --with-worker   # full demo seed + worker process
pnpm setup:local --no-start           # bootstrap only, don't start dev
pnpm setup:local --check              # preflight only, no mutations
```

What it creates automatically on first run:

- **`.env.development`** — seeded from `.env.example` with a freshly generated RS256 JWT keypair (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`) and `SECRETS_ENCRYPTION_KEY`. Existing files are never overwritten.
- **`.env.local`** — localhost override pointing `DATABASE_URL` / `REDIS_URL` at the Docker Compose stack (`postgresql://core:core@localhost:5432/core`, `redis://localhost:6379`). Use `--force-env-local` to rewrite it.

Useful flags: `--skip-deps`, `--skip-docker`, `--skip-migrate`, `--skip-codegraph`, `--with-toxiproxy`.

When it finishes, the API is at `http://localhost:3000` (`/livez`, `/readyz`).

### Option B — manual steps

If you prefer to run each step yourself:

```bash
# 1. Environment files (creates gitignored .env.<environment> from the template)
pnpm github:sync
$EDITOR .env.development        # fill DATABASE_URL, REDIS_URL, JWT_* keypair, SECRETS_ENCRYPTION_KEY

# 2. Start Postgres + Redis and wait until ready
pnpm compose:up
pnpm compose:wait

# 3. Apply migrations
pnpm db:migrate

# 4. (Optional) seed data
pnpm db:seed                    # minimal
pnpm db:seed:full               # full demo (e.g. demo@example.com / DemoPassword123!)

# 5. Run the API and worker (two terminals)
pnpm dev                        # API at http://localhost:3000
pnpm dev:worker                 # BullMQ workers (mail, webhook, notification, retention)
```

Minimum required env vars: **`DATABASE_URL`**, **`REDIS_URL`**, **`JWT_PRIVATE_KEY`** / **`JWT_PUBLIC_KEY`** (RS256 PEM pair), **`SECRETS_ENCRYPTION_KEY`** (64 hex chars). The runtime loader reads `.env.${NODE_ENV}` (defaults to `.env.development`), then applies `.env.local` as an override for local-only values.

---

## Cloud infrastructure (`setup:infra`)

Use this to provision managed providers for a shared or hosted environment (development, production). Auto-deploy on push to `dev` / `main` expects this infrastructure to already exist.

```bash
pnpm setup --init             # optional: interactive config → setup.config.json + .env.setup template
$EDITOR .env.setup            # fill provider API keys (each line has a comment with the URL)
pnpm setup:infra:preview      # show providers + where to get each token (no API calls)
pnpm setup:infra              # provision Neon, Redis, S3, Sentry, Railway, GitHub (double confirm)
pnpm setup:infra:check        # health-check provisioned resources
pnpm setup:infra:status       # what is provisioned vs missing per environment
```

Notes:

- **Config** lives in `tooling/setup/setup.config.json` (committed); **secrets** in `.env.setup` at root (gitignored).
- `setup:infra` does **not** run migrations or seeds — those run via the Continuous Deployment pipeline.
- After provisioning, it writes `.env.<environment>` files (e.g. `.env.development`, `.env.production`) you can push to GitHub Environment secrets. Regenerate anytime with `pnpm setup:infra:export-env`.
- `setup:infra:delete` only prints manual-delete dashboard URLs — it never deletes resources.

Full detail: [docs/deployment/setup/setup-automation.md](docs/deployment/setup/setup-automation.md) and [docs/deployment/setup/setup-token-instructions.md](docs/deployment/setup/setup-token-instructions.md).

---

## 2. Verify it's running

```bash
curl http://localhost:3000/livez     # liveness
curl http://localhost:3000/readyz     # readiness (DB + Redis)
```

Optional dashboards (when enabled via env flags):

- API reference (Scalar): `http://localhost:3000/api/reference` (`ENABLE_API_REFERENCE`)
- Queue dashboard: `http://localhost:3000/admin/queues` (`ENABLE_QUEUE_DASHBOARD`)

End-to-end gate (migrate → seed → live API smoke → validate):

```bash
pnpm verify:base
```

---

## 3. Common commands

| Goal | Command |
| --- | --- |
| Local run (manual) | `pnpm compose:up` → `pnpm compose:wait` → `pnpm db:migrate` → `pnpm dev` + `pnpm dev:worker` |
| Fast feedback | `pnpm test:unit` |
| Before PR | `pnpm validate && pnpm test` (full gate: `pnpm ci:local`) |
| Stop local stack | `pnpm compose:down` |
| List every script | `pnpm run` |

---

## Troubleshooting

- **Docker daemon not reachable** — start Docker Desktop / OrbStack, then re-run.
- **Port 3000 in use** — stop the other process or set `PORT` in `.env.local`.
- **Postgres never becomes ready** — tune `WAIT_FOR_POSTGRES_ATTEMPTS` / `WAIT_FOR_POSTGRES_INTERVAL_SECONDS`, or check `pnpm compose:up` logs.
- **Missing env vars on boot** — ensure `DATABASE_URL`, `REDIS_URL`, the JWT keypair, and `SECRETS_ENCRYPTION_KEY` are set in `.env.development` (or `.env.local`).

See also: [README.md](README.md) · [CLAUDE.md](CLAUDE.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/README.md](docs/README.md).
