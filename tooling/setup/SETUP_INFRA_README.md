# Setup / Infra (`tooling/setup`)

One declarative, config-driven engine provisions every third-party. There is **no**
per-provider script — all third-party setup flows through `pnpm setup:infra` and the
provider registry. It follows a plan → apply pattern (human-only, interactive).

| Concept            | Where it lives                                                              |
| ------------------ | -------------------------------------------------------------------------- |
| Declarative config | `tooling/setup/setup.config.json` (which providers + environments)         |
| State              | `.setup-state.json` (resource ids, keys, urls; gitignored)                |
| Secret variables   | `.setup-credentials` (tokens; gitignored)                                         |
| Plan / apply       | `pnpm setup:infra:plan` / `pnpm setup:infra`                              |
| Providers          | `tooling/setup/infra/providers/setup-<key>/setup-<key>.provider.ts`        |

To add a provider, see **[SETUP_INFRA_PROVIDER_TEMPLATE.md](./SETUP_INFRA_PROVIDER_TEMPLATE.md)**.

## Providers (registry)

Registered in [`infra/providers/index.ts`](./infra/providers/index.ts) — the orchestrator
iterates this list and treats each one uniformly (preview → settings-review →
detect-existing → interactive step → check → delete-instructions).

`neon` · `aws` · `sentry` · `jwt` · `resend` · `stripe` · `oauth` (Google + GitHub) ·
`posthog` · `turnstile` · `railway` · `railway-redis` · `github` · `postman` · `scalar`

Enable/disable each in `setup.config.json` (`providers.<key>.enabled`). Fill its tokens in
`.setup-credentials` (run `pnpm setup:infra:preview` to see exactly which keys each needs).

## Quick start

```bash
pnpm setup:infra:init       # generate setup.config.json + .setup-credentials template (interactive)
# → fill tokens in .setup-credentials  (which keys + where: SETUP_INFRA_PREREQUISITES.md)
pnpm setup:infra:preview    # token checklist: providers, where to get each key
pnpm setup:infra:plan       # diff: what exists vs what will be created/updated (read-only)
pnpm setup:infra            # apply — shows the plan, then walks step-wise (interactive, human-only)
```

Run a **single** provider (replaces the old per-provider scripts):

```bash
pnpm setup:infra --providers posthog
pnpm setup:infra --providers turnstile,oauth,stripe
# or via env: SETUP_INFRA_PROVIDERS=neon,jwt,github   /   SETUP_INFRA_SKIP_PROVIDERS=postman
```

## Idempotent by default — present? update or skip; absent? create

Every provider step checks whether its resource (organization / project / environment-scoped
resource) already exists before doing anything:

- **Absent** → it is **created**.
- **Present** → setup prints `Already present — …` and **asks `(u)pdate / (s)kip`** (default **skip**). Skip keeps what's there; update re-runs the step.
- **Non-interactive** (`--yes` / CI) → existing resources are **always skipped** — setup never mutates existing infrastructure unprompted.

Detection is state-based (`.setup-state.json`, via each provider's `alreadyDone()`); remote
existence is surfaced separately in `setup:infra:preview` / `detectExisting()`. Validate-only
providers (oauth, resend, stripe, turnstile) create nothing, so they simply re-validate each run.

## All scripts

### Provision / inspect (`tooling/setup/setup.ts`)

| Script                       | Action                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `setup:infra`                | Apply: show the plan, then provision step-wise (interactive, human-only) |
| `setup:infra:init`           | Interactive wizard → writes config + `.setup-credentials` template      |
| `setup:infra:preview`        | Token checklist: providers, token URLs, config keys (no writes) |
| `setup:infra:plan`           | Diff (local state): CREATE / UP-TO-DATE / UPDATE / VALIDATE per provider (read-only) |
| `setup:infra:plan:remote`    | Plan using **live remote** state (`--remote`) — drift-aware via each provider's `inspectRemote()` |
| `setup:infra:inspect`        | Remote inspection: per provider, present/absent + config-vs-remote field diff (project/env/branch/region/org) |
| `setup:infra:output`         | Masked env inventory per environment — **secrets never printed** (`--copy <KEY>` copies one to the clipboard; `--environment <env>` to filter) |
| `setup:infra:reconstruct`    | Rebuild `.setup-state.json` from live remote resources          |
| `setup:infra:export-env`     | Regenerate `.env.<environment>` files from state + secrets       |

> The bare non-infra aliases (`setup:all`, `setup:provision`, `setup:init`, `setup:preview`, `setup:dry-run`, `setup:status`, `setup:reconstruct`) were removed — use the `setup:infra*` forms above. Raw flags still work: `tsx tooling/setup/setup.ts --output|--status|--dry-run|…`.

### Infra subcommands (`tooling/setup/infra/infra.ts`)

| Script                  | Action                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `setup:infra:check`     | Health-check provisioned providers                          |
| `setup:infra:status`    | Per-environment resource status                             |
| `setup:infra:dry-run`   | Dry-run plan of the infra steps                             |
| `setup:infra:delete` / `setup:infra:revert` | Print the **manual** delete guide (setup never deletes resources itself) |

### Env files (`tooling/setup/envs/envs.ts`)

| Script              | Action                                              |
| ------------------- | -------------------------------------------------- |
| `setup:envs`        | Build `.env.<environment>` files                   |
| `setup:envs:check`  | Verify env files are in sync                        |
| `setup:envs:diff`   | Show diff vs current env files                      |
| `setup:envs:clone`  | Clone one environment's env file to another        |

### GitHub repo / environment secrets (`tooling/setup/github/`)

| Script                  | Action                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `setup:github` / `github:sync` | Scaffold repo, branches, rulesets, Environments; push `.env.<env>` |
| `setup:github:check`    | Consistency + remote drift (read-only)                         |
| `setup:github:dry-run` / `github:sync:dry-run` | Preview the sync                              |
| `setup:github:status`   | Repo / environment secret status                              |

### Domain & misc

| Script                                | Action                                            |
| ------------------------------------- | ------------------------------------------------- |
| `setup:domain` / `setup:infra:domain` | Attach a Railway custom domain (`railway/custom-domain.ts`) |
| `setup:retention-secrets` / `setup:push-retention-secrets` | Push retention worker secrets |
| `setup:local`                         | Local-only dev bootstrap (`tooling/dev/setup-local.ts`; not a third-party) |

## Security — secrets never leak (enforced)

Secrets are written to **`.env.<environment>` only** (via provisioning / `setup:infra:export-env`) and never printed to the terminal or committed. This is enforced, not just convention:

- **One home for secrets.** Secret values are only ever written to `.env.<environment>` (by provisioning / `setup:infra:export-env`). For normal setup you never copy/paste — values land in the env file automatically.
- **Never printed.** Providers log status only (`valid` / `resolved`), never a value. `setup:infra:output` shows a masked inventory (`••••`); no secret is ever written to stdout. Connection strings with embedded credentials (`DATABASE_URL`, `REDIS_URL`) are masked by value, not just key name.
- **Clipboard, not terminal.** Need one value elsewhere (e.g. a third-party dashboard)? `setup:infra:output --copy <KEY>` puts it on the **system clipboard** (auto-cleared after ~20s) and prints only a confirmation — it never enters the terminal or an agent transcript. Each copy is recorded to the gitignored `.setup-state.audit.log` (key + env + timestamp, never the value). No clipboard tool → it refuses and points you at `.env.<environment>`.
- **Unreadable by the agent.** The `guardrails.mjs` PreToolUse hook **denies the agent** Read/Bash access to `.env.<env>`, `.setup-credentials`, and `.setup-state.json` (templates `*.example` stay readable). So secrets are out of reach even though the files sit on disk.
- **Can't be committed.** `.env*` (except `*.example`) and `.setup-state.*` are gitignored; pre-commit runs **gitleaks `protect --staged`** plus a **"No secret/state files staged"** guard that blocks even `git add -f`. Both also run in CI.

> Note: `.setup-state.json` is stored as **plaintext** (gitignored) — the protections above (no-print, clipboard, deny-read, gitignore, pre-commit guards) cover the threats here without a self-managed encryption key.

Every provider starts with a standard header (name · description · NAMING source · SECRETS rule). When adding a provider, follow the same header + rules — see the template's security section.

## File map

| Area                 | Files                                                            |
| -------------------- | --------------------------------------------------------------- |
| Config & init        | `common/config.ts`, `infra/init-wizard.ts`, `setup.config.json` |
| Secrets (`.setup-credentials`) | `common/secrets.ts`                                          |
| State                | `common/state.ts` (`.setup-state.json`, gitignored plaintext) |
| Secret output viewer | `infra/output.ts` + `common/clipboard.ts` (`setup:infra:output --copy`) |
| Agent deny-read      | `agent-os/hooks/guardrails.mjs` (blocks Read/Bash of secret files) |
| Orchestrator         | `infra/orchestrator.ts` (registry-driven)                      |
| Guide                | `infra/guide.ts`                                               |
| Prerequisites        | `infra/prerequisites.ts`                                       |
| Providers            | `infra/providers/setup-<key>/setup-<key>.provider.ts`, `infra/providers/index.ts` |
| Env-var emission     | `envs/build-env-vars.ts`                                       |
| Docs                 | `docs/deployment/setup/setup-token-instructions.md`           |

## Lift into a new product

This module is config-driven and standalone — to reuse it in another product:

1. Copy `tooling/setup/` into the new repo and add the `setup:infra*` scripts to its `package.json`.
2. Run `pnpm setup:infra:init` to generate that product's `setup.config.json` (its own
   organization / project / environment names — the single source of truth) and `.setup-credentials`.
3. Trim `setup.config.json` providers to the ones the product uses.

The provisioning **engine** (`common/`, `infra/`, `infra/providers/`) has no `@/` (app)
imports, so it ports cleanly. The only product-coupled spot is the GitHub env-secret sync
(`github/*`), which reads the product's own `@/shared/config/env-schema` (and a shared
util) — that `@/` is product-relative and resolves to the new product's `src/` by design.

## See also

- **[SETUP_INFRA_PREREQUISITES.md](./SETUP_INFRA_PREREQUISITES.md)** — which credentials you must obtain per provider + where to get them.
- **[SETUP_INFRA_PROVIDER_TEMPLATE.md](./SETUP_INFRA_PROVIDER_TEMPLATE.md)** — add a new provider.
- `docs/deployment/setup/setup-token-instructions.md` — where to get each token.
- `.claude/skills/setup-infra-maintainer/SKILL.md` — the agent checklist (run when adding/removing a provider).
