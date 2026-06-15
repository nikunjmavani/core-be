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
| Docker images (Postgres / Redis) | `registry-1.docker.io` (Docker Hub) |
| Google OAuth | `accounts.google.com` |

Add the rest via **Custom** (tick "Also include default list of common package managers"):

- `nodejs.org` — **always**, for the Node 24 download in the setup script. Without it the install is blocked.
- Tier 3 only (live calls; contract tests mock these, so usually unnecessary): `api.stripe.com`, `api.resend.com`, `sentry.io` / `*.ingest.sentry.io`.

> **Do not use `None`** — it blocks `pnpm install` entirely.

---

## Setup script

Paste into the **Setup script** field:

```bash
bash tooling/setup/agent/install-node.sh
```

On the first session the cached Node 24 is already on disk, [`session-start.sh`](../../agent-os/hooks/session-start.sh) switches `PATH` to `/opt/node24`, and runs `pnpm install`. Do **not** start Postgres / Redis here — setup-script processes do not persist; start them per session (below).

---

## Environment variables (Tier 2)

Static checks and unit tests need **no** env vars. For DB-bound and e2e tests, mirror the `api-smoke` service in [`docker-compose.yml`](../../docker-compose.yml) (test-safe values; `pnpm compose:up` publishes Postgres on `localhost:5432` and Redis on `localhost:6379`):

```text
NODE_ENV=test
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
- **JWT keys** (`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`) are multi-line RS256 PEMs that the env-var field handles poorly. Tests that sign tokens should generate them in a SessionStart hook (writing to a gitignored `.env.test`) or via `pnpm setup:infra`; static checks and unit tests do not need them.

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

---

## Tiers — what to enable for which goal

| Tier | Goal | Network | Services | Env vars |
| ---- | ---- | ------- | -------- | -------- |
| **1** | Lint, typecheck, unit tests, the gates | Custom: defaults + `nodejs.org` | none | none |
| **2** | DB-bound + e2e tests, migrations, seed, api-smoke | same | `pnpm compose:up` (Postgres + Redis) | minimal boot set above |
| **3** | Live Stripe / Resend / S3 / Sentry calls | + their API hosts | + Postgres / Redis | + real test keys |

---

## Setup flow

```mermaid
flowchart TD
  create["Create environment"] --> net["Network: Custom + nodejs.org"]
  net --> setupScript["Setup script: install-node.sh (cached)"]
  setupScript --> firstRun["First session launches"]
  firstRun --> hook["session-start.sh: switch to /opt/node24, pnpm install"]
  hook --> tier1["Tier 1 ready: validate / test:unit / agent-os:check"]
  tier1 --> tier2["Tier 2: pnpm compose:up + pnpm compose:wait"]
  tier2 --> migrate["pnpm db:migrate + pnpm db:seed"]
  migrate --> tests["DB-bound + e2e tests, api-smoke"]
```

---

## core-be gotchas

- **Node 24 is not pre-installed** — the setup script is mandatory; without it the session is stuck on Node 22 and `engines` rejects it.
- **`nodejs.org` is not in the default Trusted allowlist** — the most common miss.
- **Husky is inactive on the web** (no `core.hooksPath`), so commits and pushes skip local pre-commit / pre-push hooks — rely on CI and `pnpm agent-os:check` / `pnpm ci:local`.
- **Pushes are pinned to the session's `claude/*` branch** by the git proxy; the branch-naming policy allowlists `claude/*` for exactly this reason.

---

## Related documentation

- [cursor-cloud-agent-environment.md](cursor-cloud-agent-environment.md) — the Cursor cloud-agent equivalent (`Dockerfile.agent`).
- [SETUP.md](../../SETUP.md) — local human setup, env vars, testing, CI/CD.
- [agent-os/hooks/README.md](../../agent-os/hooks/README.md) — the SessionStart hook and the other Claude Code hooks in this repo.
- [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web) — setup scripts, network policies, environment caching.
