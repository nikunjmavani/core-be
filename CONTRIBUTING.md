# Contributing to core-be

Thank you for improving this backend. This document is intentionally short—use **[CLAUDE.md](CLAUDE.md)** for architecture and **[AGENTS.md](AGENTS.md)** for the full agent and CI checklist.

## Prerequisites

- **Node.js** — version in [`.nvmrc`](.nvmrc) (project expects Node 24 per `package.json` `engines`)
- **pnpm** — package manager used by this repo
- **Docker** — Postgres and Redis (see [`docker-compose.yml`](docker-compose.yml))
- **Environment** — new hosted env: add to `tooling/setup/setup.config.json` and `NODE_ENV` in the schema, then `pnpm tool:generate-project-identity` and `pnpm github:sync`. Fill in real values (defaults to `NODE_ENV=development` → `.env.development`). Push to GitHub: `pnpm github:sync <environment>`.

## Local setup

One command (Docker + env + migrate + dev): `pnpm setup:local`. Full clone-to-running guide: **[SETUP.md](SETUP.md)**. Manual steps:

```bash
pnpm install
pnpm compose:up
pnpm compose:wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Worker process (optional): `pnpm dev:worker`

## Repository layout

| Path                                                   | Purpose                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`tooling/setup/`](tooling/setup/)                     | External infrastructure wizard (`pnpm setup:infra`) — Neon, Railway, Stripe, etc.; config in `tooling/setup/setup.config.json` |
| [`tooling/ci/`](tooling/ci/)                           | Build/CI guards — Dockerfile sync, `dist/` `@/` alias check (`pnpm docker:check-sync`, `pnpm build:check`)                     |
| [`tooling/dev/`](tooling/dev/)                         | Local dev helpers — e.g. `pnpm compose:wait` (Postgres readiness)                                                              |
| [`src/scripts/`](src/scripts/)                         | Repo tooling invoked via `pnpm` — OpenAPI generation, route catalog, DB seeds, `verify-base`                                   |
| [`src/domains/<domain>/`](src/domains/)                | Business domains; route tests and domain unit tests live in `__tests__/` under each domain                                     |
| [`src/domains/<domain>/__tests__/unit/`](src/domains/) | Domain validator/serializer unit tests (not under `src/tests/unit/`)                                                           |
| [`src/tests/`](src/tests/)                             | Cross-cutting tests — security, chaos, contract, global regression, shared helpers and factories                               |

### Repository root

Committed files at the project root (not directories) group as follows:

| Category           | Examples                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Package / Node     | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `.nvmrc`, `.node-version` |
| Quality            | `biome.json`, `.biomeignore`, `.editorconfig`, `tooling/vitest/`                                   |
| Data               | `drizzle.config.ts`, `migrations/`                                                                 |
| Containers         | `Dockerfile`, `Dockerfile.worker`, `Dockerfile.agent`, `docker-bake.hcl`, `docker-compose.yml`     |
| Env                | `.env.example` (committed); every `.env.*` per-environment file gitignored                         |
| Policy / community | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `CHANGELOG.md` |

Application code, human docs, and automation live under `src/`, `docs/`, and `tooling/` respectively.

## Project layout and patterns

Read **[CLAUDE.md](CLAUDE.md)** for domains, layers (controller → service → repository), Drizzle conventions, queues, and dependency rules.

## New features or API work

Use **[docs/getting-started/requirement-intake.md](docs/getting-started/requirement-intake.md)** so scope, routes, and docs stay coherent. Consult **[`.cursor/skills/skill-index/SKILL.md`](.cursor/skills/skill-index/SKILL.md)** to see which automation skills apply to your change.

## Branches

Use prefixes such as:

- `feat/` — features
- `fix/` — bug fixes
- `chore/` / `docs/` / `ci/` — maintenance

## Commits and releases

Commits should follow **[Conventional Commits](https://www.conventionalcommits.org/)** (e.g. `feat:`, `fix:`, `feat!:` for breaking changes). **[Release Please](.github/workflows/post-merge-ci.yml)** (job inside Post-merge CI) uses that history for changelog and versioning on both release channels: `main` produces stable releases (e.g. `v2.1.0`); `dev` produces pre-releases (e.g. `v2.1.0-dev.0`). Each channel tracks its own version via a dedicated manifest (under [.github/release-please/](.github/release-please/)), so they never collide.

## Git hooks (Husky)

[Husky](.husky/) runs checks locally. Fix failures rather than skipping hooks (`--no-verify`).

| Hook | Script | What runs |
| --- | --- | --- |
| **pre-commit** | [`.husky/pre-commit`](.husky/pre-commit) | `lint-staged` (Biome on `src/**/*.ts` and `tooling/**/*.{ts,mjs}`; Biome format on `*.{json,yaml,yml}`; markdownlint on `*.md`), `typecheck`, `validate:domain:strict`, route catalog / OpenAPI sync when relevant files change, env-example sync, optional Gitleaks on staged files, conflict-marker and large-file guards |
| **commit-msg** | [`.husky/commit-msg`](.husky/commit-msg) | [Conventional Commits](https://www.conventionalcommits.org/) via commitlint |
| **pre-push** | [`.husky/pre-push`](.husky/pre-push) | `typecheck`, `build`, `build:check`, `test:unit` |

**Gitleaks:** Install the [Gitleaks CLI](https://github.com/gitleaks/gitleaks) so pre-commit secret scanning is not skipped. CI always runs a full-repo scan. Manual check: `pnpm security:secrets`.

**Full PR gate:** `pnpm ci:local` (or wait for CI) — includes dependency audit, Semgrep, contract tests, domain coverage, and the full test suite. Pre-commit and pre-push are faster subsets.

## Architecture consistency (routes and domains)

When you change HTTP routes or domain layout:

1. Run **`pnpm routes:catalog`** and commit **`docs/routes.txt`** (auto-generated; do not edit by hand).
2. Ensure **`pnpm docs:check`** passes when routes or OpenAPI metadata change (`docs/openapi/` and `docs/postman-collection.json` are gitignored; the check regenerates both and compares snapshots—do not commit them or rely on `git diff` for drift).
3. CI runs **`pnpm routes:catalog:check`**, **`pnpm docs:check`**, **`pnpm validate:domain:strict`**, and **`pnpm validate:domain:coverage`**.
4. Domain route tests live under **`src/domains/<domain>/__tests__/`**; cross-cutting tests under **`src/tests/`**.
5. Production API images embed route/OpenAPI docs for MCP — see **[deployment/docker-images.md](docs/deployment/docker-images.md)**.

See **`docs/reference/architecture/domains-and-public-api-design.md`** §1.4 for intentional layout variants (bundled vs per-sub-domain routes).

## Tests

Common commands:

- `pnpm test:unit` — unit tests
- `pnpm test:e2e` — domain route tests
- `pnpm test` — full Vitest suite (serial)

Details: **[CLAUDE.md](CLAUDE.md)** (Testing section).

## Before you open a pull request

**Authors:** run the gate described in **[AGENTS.md](AGENTS.md)** (`pnpm ci:local`, or `pnpm ci:quality` for static checks only). Adjust when your change touches migrations or environment schema only. Fill in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) (Summary, Test plan, Reviewer notes).

**Reviewers:** use **[docs/process/pr-review.md](docs/process/pr-review.md)** — shared human and agent checklist (architecture, security, migrations, routes, tests, doc-sync map). Required CI check names: **[docs/deployment/ci-cd/branch-protection.md](docs/deployment/ci-cd/branch-protection.md)**.

## User-facing strings

Errors and API messages must use i18n keys—see **[`.cursor/skills/i18n-message-guard/SKILL.md`](.cursor/skills/i18n-message-guard/SKILL.md)**.

## Code of conduct and security

- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — community expectations
- **[SECURITY.md](SECURITY.md)** — how to report vulnerabilities privately

## GitHub repository setup (maintainers)

**Deploy secrets (per environment: `development`, `production`):** besides `RAILWAY_SERVICE_ID` (API), set `RAILWAY_WORKER_SERVICE_ID` for the BullMQ worker service and `DATABASE_MIGRATION_URL` when migrations use an elevated DB user. CD runs `pnpm db:migrate` before `railway redeploy --service ... --yes`.

Completing this once avoids broken defaults for contributors:

- **Labels** — Create path labels used by [`.github/labeler.yml`](.github/labeler.yml) and PR size labels (`size/small`, `size/medium`, `size/large`, `size/x-large`) if you use automated labeling.
- **Security advisories** — Ensure **private vulnerability reporting** is enabled (`Settings → Security → Code security`).
- **Placeholders** — Replace any placeholders in **`SECURITY.md`** using your canonical GitHub slug (compare `git remote get-url origin`).
- **Contacts** — Set a real **`security@…`** address in **`SECURITY.md`** and enforcement contact in **`CODE_OF_CONDUCT.md`** (currently placeholders).

Issue templates are not configured; use **Discussions** or open a **pull request** directly. Pull request starter text: [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). Automation index: [`.github/README.md`](.github/README.md).
