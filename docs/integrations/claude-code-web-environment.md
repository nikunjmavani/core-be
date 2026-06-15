# Claude Code on the web — environment for core-be

Use this when you run **[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)** (cloud sessions at claude.ai/code) against this repository. It describes the environment you must create so `pnpm install`, the validation gates, and the test suite work — and what to add when you need a database or live third-party calls.

The Cursor equivalent is [cursor-cloud-agent-environment.md](cursor-cloud-agent-environment.md); local human setup is [SETUP.md](../../SETUP.md).

---

## TL;DR — the environment to create

For day-to-day work (lint, typecheck, unit tests, and the `agent-os` / route / tsdoc gates):

| Lever | Value |
| ----- | ----- |
| **Network access** | **Custom** — keep the default allowlist and add `nodejs.org` |
| **Setup script** | `bash tooling/setup/agent/install-node.sh` |
| **Environment variables** | none required |
| **Runtime services** | none — static checks and unit tests need no database |

That makes `pnpm install` → `pnpm validate` / `pnpm test:unit` / `pnpm agent-os:check` / `pnpm routes:catalog:check` / `pnpm tsdoc:check` work. Add a database and env vars only for DB-bound tests (Tier 2), and third-party hosts only for live integrations (Tier 3).

---

## Why a setup script is required

The cloud image ships **Node 20, 21, and 22**; core-be's `engines` require **Node 24+** (pinned in [`.nvmrc`](../../.nvmrc)). Node 24 is **not** pre-installed, so a setup script must install it. [`tooling/setup/agent/install-node.sh`](../../tooling/setup/agent/install-node.sh) installs the `.nvmrc` version into `/opt/node24` — the same layout the image uses and exactly where the [`session-start.sh`](../../agent-os/hooks/session-start.sh) hook looks — so the hook switches `PATH` to it and runs `pnpm install` automatically. The repo's Node version is unchanged.

---

## The four levers

Set these in the environment settings dialog (web UI). See the [configuration docs](https://code.claude.com/docs/en/claude-code-on-the-web#the-cloud-environment).

1. **Network access** — `None` / `Trusted` / `Full` / `Custom`. `Trusted` (the default) allows a built-in allowlist of registries, GitHub, and cloud SDKs.
2. **Environment variables** — `.env` format, one `KEY=value` per line, **no quotes**. Stored in the environment config and visible to anyone who can edit it (there is no secrets store), so use **test** keys, never live secrets.
3. **Setup script** — Bash, runs **as root before the session launches**, and its filesystem result is **cached** (it re-runs only when you change the script or the allowlist, or after roughly seven days). Use it for runtimes and system packages.
4. **Runtime services** — PostgreSQL and Redis are **pre-installed but not running**, and Docker is available. Setup-script *processes* do not persist (only the filesystem), so start services **per session**.

---

## Network access

The default **Trusted** allowlist already covers what `pnpm install` and image pulls need:

| Need | Host(s) already in Trusted |
| ---- | -------------------------- |
| pnpm / npm | `registry.npmjs.org` |
| Git / GitHub | `github.com` (plus the GitHub proxy) |
| S3 (uploads) | `*.amazonaws.com` |
| Docker images (Postgres / Redis) | `registry-1.docker.io` + `auth.docker.io` (manifest/auth only — image **layers** need the CDN below) |
| Google OAuth | `accounts.google.com` |

Add the rest via **Custom** (tick "Also include default list of common package managers"):

- `nodejs.org` — **always**, for the Node 24 download in the setup script. Without it the install is blocked.
- `production.cloudfront.docker.com` — **Tier 2 only if you use Docker** for Postgres/Redis. `registry-1.docker.io` resolves the image manifest, but the actual layers download from this Docker Hub CloudFront CDN; without it `docker compose up` returns `403 Forbidden` mid-pull. Not needed if you use the pre-installed **native** Postgres/Redis instead (see Runtime services).
- Tier 3 only (live calls; contract tests mock these, so usually unnecessary): `api.stripe.com`, `api.resend.com`, `sentry.io` / `*.ingest.sentry.io`.

> **Do not use `None`** — it blocks `pnpm install` entirely.

---

## Setup script

Paste into the **Setup script** field (runs as root, cached):

```bash
bash tooling/setup/agent/install-node.sh
bash tooling/setup/agent/install-gh.sh   # optional: GitHub CLI fallback
```

On the first session the cached Node 24 is already on disk, [`session-start.sh`](../../agent-os/hooks/session-start.sh) switches `PATH` to `/opt/node24`, and runs `pnpm install`. Do **not** start Postgres / Redis here — setup-script processes do not persist; start them per session (below).

**GitHub CLI (optional).** [`install-gh.sh`](../../tooling/setup/agent/install-gh.sh) adds `gh` as an in-session fallback for reading Actions logs, checking CI, and merging (the GitHub MCP tools already cover this). It belongs in the cached **setup script**, not `session-start.sh` — a per-session `apt install` would not cache and would slow every startup. Set `GH_TOKEN` in the environment's **Variables** (least-privilege: `contents` + `pull_requests` + `actions:read`; env vars are not a secrets store). Its apt-repo fallback needs `cli.github.com` on the network allowlist.

**Troubleshooting — `bash: tooling/setup/agent/install-node.sh: No such file or directory` (exit 127).** The Setup script is cached and runs as root before the session. If the cached layer predates these helper scripts, or executes from a directory other than the repo checkout, the relative path will not resolve. First, re-save the Setup script field and start a **fresh** session — that rebuilds the cache against the current checkout (where the scripts exist). If it still fails, an absolute path is working-directory-independent; use the session's checkout path (here `/home/user/core-be`):

```bash
bash /home/user/core-be/tooling/setup/agent/install-node.sh
bash /home/user/core-be/tooling/setup/agent/install-gh.sh   # optional
```

---

## Environment variables

**Tests need none.** [`src/tests/setup.ts`](../../src/tests/setup.ts) bakes in test RS256 JWT PEMs and sets every other value (`??=` or hard override), and [`src/tests/global-setup.ts`](../../src/tests/global-setup.ts) forces `DATABASE_URL` to the local Docker DB and runs `pnpm db:migrate`. So the full suite runs with **only Postgres + Redis up** — no env vars and no key generation, exactly like local.

You only need env vars to run the **app itself** (`pnpm dev` / `pnpm dev:worker`). Mirror the `api-smoke` service in [`docker-compose.yml`](../../docker-compose.yml) (`pnpm compose:up` publishes Postgres on `localhost:5432` and Redis on `localhost:6379`):

```text
NODE_ENV=development
DATABASE_URL=postgresql://core:core@localhost:5432/core
DATABASE_MIGRATION_URL=postgresql://core:core@localhost:5432/core
REDIS_URL=redis://localhost:6379
DATABASE_SSL_ENABLED=false
METRICS_ENABLED=false
SECRETS_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

- `DATABASE_MIGRATION_URL` must be the **direct (non-pooler)** host — `pnpm db:migrate` rejects a pooler URL.
- `DATABASE_SSL_ENABLED=false` is for plaintext local Docker only.
- `METRICS_ENABLED=false` avoids requiring `METRICS_SCRAPE_TOKEN` at boot.
- **JWT keys** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`) are multi-line RS256 PEMs the env-var field handles poorly; generate them in a SessionStart hook (writing to a gitignored `.env.local`) or via `pnpm setup:infra`. Tests do not need this — they use the baked-in keys in [`src/tests/setup.ts`](../../src/tests/setup.ts).

The full variable surface and how to obtain real values: [`.env.example`](../../.env.example) and [credentials-and-env.md](credentials-and-env.md).

---

## Runtime services (Postgres, Redis)

Use the repo's compose scripts — the **same ones you run locally** — so the cloud session matches local exactly. Run per session (or from a SessionStart hook):

```bash
pnpm compose:up      # start Postgres + Redis (same as local)
pnpm compose:wait    # block until Postgres accepts connections
pnpm db:migrate
pnpm db:seed         # or pnpm db:seed:full
```

`pnpm compose:up` also starts the local SonarQube container unless you set `SONAR=0`; a cloud session rarely needs it, so `SONAR=0 pnpm compose:up` brings up just Postgres + Redis. Stop everything with `pnpm compose:down`.

**Docker daemon (required before `compose:up`).** Docker is installed but its **daemon is not running**, and a daemon launched from the cached **Setup script won't persist** (only the filesystem is cached) — so it must start per session. Set the **Variable** `START_DOCKER=1` and the [`session-start.sh`](../../agent-os/hooks/session-start.sh) hook launches `dockerd` at session start (the banner then reads `docker running`); or start it on demand with `dockerd >/tmp/dockerd.log 2>&1 &`. Image pulls **also** require `production.cloudfront.docker.com` on the allowlist (see Network access) — without it `docker compose up` returns `403 Forbidden` on layer downloads.

**Native alternative (no Docker).** Postgres 16 and Redis 7 are pre-installed (`/usr/lib/postgresql/16/bin`, `redis-server`). When the Docker layer CDN isn't allowlisted, run them natively on the ports the tests expect: `redis-server --daemonize yes` for Redis, and for Postgres an `initdb`'d cluster (run as the `postgres` user with `-U core` and trust auth) started on `5432` with a `core` database — satisfying `postgresql://core:core@localhost:5432/core`. The test harness ([`global-setup.ts`](../../src/tests/global-setup.ts)) does not care whether Postgres is Docker or native.

---

## Tiers — what to enable for which goal

| Tier | Goal | Network | Services | Env vars |
| ---- | ---- | ------- | -------- | -------- |
| **1** | Lint, typecheck, unit tests, the gates | Custom: defaults + `nodejs.org` | none | none |
| **2** | Full test suite (e2e / integration), migrations, seed | same | `pnpm compose:up` (Postgres + Redis) | none — tests self-provision |
| **3** | Run the app (`pnpm dev` / `pnpm dev:worker`) | same | `pnpm compose:up` | the boot block above |
| **4** | Live Stripe / Resend / S3 / Sentry calls | + their API hosts | + Postgres / Redis | + real test keys |

---

## Session startup vs on-demand

Startup stays **light** so a session is ready fast: the setup script (Node 24, cached) plus `session-start.sh`, which runs `pnpm install` and a single `pnpm agent-os:check` readiness gate. Nothing else is bootstrapped.

Everything else runs **on demand, driven by your prompt** — `pnpm compose:up` for the database, `pnpm db:migrate` / `pnpm db:seed`, the test suite, or `pnpm dev` — started only when a task needs it.

## How to tell a session is provisioned

The `session-start.sh` banner (top of every session) leads with **`environment provisioned: yes|no`** — `yes` means the cached toolchain the Setup script builds (Node ≥ `.nvmrc` + installed deps) is live in this session. The same line reports `Node`, `deps`, `gh`, `codegraph`, and `agent-os` status. Manual cross-checks: `node -v` (expect 24.x), `gh --version`, `ls /opt/node24`.

A `no` means the Setup script has not built this cache yet (e.g. Node still 22, deps missing) — configure the Setup script + `nodejs.org` allowlist, then start a fresh session.

## Setup flow

```mermaid
flowchart TD
  create["Create environment"] --> net["Network: Custom + nodejs.org"]
  net --> setupScript["Setup script: install-node.sh (cached)"]
  setupScript --> hook["session-start.sh: /opt/node24, pnpm install, agent-os:check"]
  hook --> ready["Session ready (light startup)"]
  ready -->|"your prompt drives work"| prompt["Work starts per prompt"]
  prompt --> staticChecks["validate / test:unit / agent-os:check"]
  prompt --> services["pnpm compose:up + pnpm compose:wait"]
  services --> migrate["pnpm db:migrate + pnpm db:seed"]
  migrate --> dbWork["e2e / DB tests, or pnpm dev"]
```

---

## core-be gotchas

- **Node 24 is not pre-installed** — the setup script is mandatory; without it the session is stuck on Node 22 and `engines` rejects it.
- **`nodejs.org` is not in the default Trusted allowlist** — the most common miss.
- **Husky activates after `pnpm install`** (its `prepare` step), so a properly configured session gets the **same** pre-commit / pre-push gates as local — including the pre-push SonarQube gate, which needs `pnpm sonar:up` or `SKIP_SONAR=1 git push`. Before deps install (e.g. a session still on Node 22) Husky is inactive and commits skip the hooks.
- **Pushes are pinned to the session's `claude/*` branch** by the git proxy; the branch-naming policy allowlists `claude/*` for exactly this reason.

---

## Related documentation

- [cursor-cloud-agent-environment.md](cursor-cloud-agent-environment.md) — the Cursor cloud-agent equivalent (`Dockerfile.agent`).
- [SETUP.md](../../SETUP.md) — local human setup, env vars, testing, CI/CD.
- [agent-os/hooks/README.md](../../agent-os/hooks/README.md) — the SessionStart hook and the other Claude Code hooks in this repo.
- [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web) — setup scripts, network policies, environment caching.
