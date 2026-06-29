---
name: setup-infra-maintainer
description: Keeps setup:infra third-party providers and all dependent files in sync. Use when adding or removing any provider (Neon, Railway Redis, AWS, Sentry, GitHub, Railway, Postman, Stripe, Resend, OAuth, etc.).
---

# Setup infra maintainer (core-be)

## Purpose

When you **add or remove a third-party provider** in the setup:infra flow (`pnpm setup:infra`, `setup:infra:init`, `setup:infra:preview`), **every dependent file** must be updated in the same change. This skill is the checklist so nothing is missed.

## When to Use

- **Adding** a new third-party (e.g. new provider for secrets, DB, queue, or deploy).
- **Removing** an existing third-party from setup.
- **Renaming** or **changing the shape** of a provider (new secret keys, new config fields).

## Source of truth (provider list)

Registered in `tooling/setup/infra/providers/index.ts` (`INFRA_PROVIDERS`): **Neon**, **AWS**, **Sentry**, **JWT**, **Resend**, **Stripe**, **OAuth (Google + GitHub)**, **PostHog**, **Turnstile**, **Railway**, **Railway Redis**, **GitHub** (repo/env secrets), **Postman**, **Scalar**. Each appears in multiple places below; keep them in sync.

> **Quickest path to add one:** follow [`tooling/setup/SETUP_INFRA_PROVIDER_TEMPLATE.md`](../../../tooling/setup/SETUP_INFRA_PROVIDER_TEMPLATE.md) (10-step checklist + copy-paste `InfraProvider` skeleton). This skill is the exhaustive reference behind that template. Overview of the whole flow + all scripts: [`tooling/setup/SETUP_INFRA_README.md`](../../../tooling/setup/SETUP_INFRA_README.md).

## Naming — SINGLE SOURCE OF TRUTH (strict)

`tooling/setup/setup.config.json` is the **one** place these names are defined. Every script and provider MUST read them from the loaded config — **never hardcode a literal**:

- `project.name` — PROJECT NAME · `project.displayName` — human-readable name · `project.organization` — ORGANIZATION NAME · `environments[].name` — ENVIRONMENT NAMES.

Alias maps (`dev→development`) only normalize input; the canonical value is still config. A default that duplicates a name (e.g. a hardcoded slug `'core-be'`) is a violation — derive from `config.project.*` / `config.environments[]`. Only `init-wizard.ts` may hold seed defaults, because it *writes* the config. Add a `// NAMING (single source of truth = setup.config.json): …` comment in each script that touches org/project/env names.

## Secrets never leak (strict, enforced)

- **Never print a secret value.** Providers log status only (`valid`, `resolved`) — never a key/token/password/connection-string, including in error messages. A `logger.*` that interpolates a secret is a violation.
- **Secrets go to `.env.<environment>` only** (`build-env-vars.ts` → provisioning). `pnpm setup:infra:output` shows a masked inventory; `--copy <KEY>` puts one value on the **clipboard** (never stdout, auto-cleared, audit-logged). `infra/output.ts` masks by key pattern and by value (embedded-credential URLs like `DATABASE_URL`); `common/clipboard.ts` shells out to pbcopy/wl-copy/xclip/xsel/clip.
- **`.setup-state.json` is gitignored plaintext** (no encryption layer). **Agent deny-read:** `agent-os/hooks/guardrails.mjs` blocks the agent from Read/Bash-reading `.env.<env>` / `.env.setup` / `.setup-state.json` (matcher includes `Read` in `.claude/settings.json`).
- **Every provider starts with the common header** — name · description · NAMING (config only) · SECRETS rule. See the skeleton in `SETUP_INFRA_PROVIDER_TEMPLATE.md`.
- **Idempotent (present? update or skip · absent? create)** — resource-creating providers implement `alreadyDone()`/`alreadyDoneEnvironments()`; `runInteractiveStep` then prompts `(u)pdate / (s)kip` when present (default skip; auto-skip in `--yes`/CI) and creates when absent. Validate-only providers omit it.
- **Enforcement:** `.env*` (except `*.example`) + `.setup-state.*` gitignored; pre-commit runs gitleaks `protect --staged` + the "No secret/state files staged" guard (`src/scripts/tooling/run-pre-commit-guard.ts`); both run in CI. Never weaken these.

---

## Checklist: ADD a new third-party provider

Work through each section. Do not skip; missing any item will break init, preview, or provisioning.

### 1. Config schema and init defaults

- **`tooling/setup/common/config.ts`** — In `setupConfigSchema.providers`, add the new provider object (e.g. `enabled: z.boolean()`, plus any provider-specific fields: region, repository, fromAddress, etc.). Match the shape used in orchestrator and providers.
- **`tooling/setup/infra/init-wizard.ts`** — In `buildConfig()`, add the new provider under `config.providers` with sensible defaults (e.g. `newProvider: { enabled: true, ... }`).

### 2. Secrets (env-style .env.setup)

- **`tooling/setup/common/secrets.ts`** — In `setupSecretsSchema`, add the new provider’s secret shape (e.g. `newProvider: z.object({ apiKey: z.string() })`). Also update `loadSecretsFromEnv` to read the new key(s) and include them in the returned `SetupSecrets` object; update `hasAnyEnvSecret` if the new secrets should count toward “any secret filled”.
- **`tooling/setup/common/secrets.ts`** (env-secrets / `.env.setup` template logic):
  - **`TOKEN_URLS`** — Add `NEW_PROVIDER_API_KEY: ‘https://...’` (URL where user gets the key).
  - **`SIMPLE_VARS`** — If the provider uses a single env var (or a fixed set), add `[‘NEW_PROVIDER_API_KEY’, TOKEN_URLS.NEW_PROVIDER_API_KEY]` so the template and `appendMissingEnvSetupVariables` include it.
  - **`buildEnvSetupTemplateContent`** — If the provider uses more than the simple vars (e.g. per-env keys), add the corresponding blocks (comments + `KEY=` lines) after the existing loops.
  - **`appendMissingEnvSetupVariables`** — Already uses `SIMPLE_VARS`; if the new provider needs per-env vars, add a loop similar to Stripe (check existing keys, append missing blocks).

### 3. Orchestrator (registry-driven — DO NOT EDIT)

`tooling/setup/infra/orchestrator.ts` iterates `INFRA_PROVIDERS` and calls each provider's
interface hooks uniformly — there are **no** hardcoded `PREVIEW_PROVIDERS` /
`displaySettingsReview` lists, and **no** rollback/destroy. You add behaviour by
implementing hooks on your `InfraProvider` (step 6), not by editing the orchestrator:

- **`preview(context)`** → returns `{ detail, url, configKey }` (shown in `setup:infra:preview`).
- **`settingsReview(context)`** → returns settings-review entries.
- **`detectExisting(context)`** → optional pre-existence detection.
- **`buildStep(context)`** → the interactive provision step (calls `provision`, then `context.applyStateUpdates(result.stateUpdates ?? {})` for state-backed providers).
- **`check(context)`** → health check for `setup:infra:check`.
- **`deleteInstructions(context)`** → for any provider that writes to `.setup-state.json`, return `{ provider, dashboardUrl, steps?, resources: [{ label, identifier }] }` (rendered by `pnpm setup:infra --delete`). Never add `destroy`/`destroyEnvironment` — `setup:infra` does not delete resources or roll back; failures stop the run and the user cleans up via the printed guide.

### 4. Guide (browser + instructions)

- **`tooling/setup/infra/guide.ts`** — In `buildGuideSteps()`, add a new step:
  - `providerName`: display name (e.g. “NewProvider”).
  - `enabledCheck`: `(config) => config.providers.newProvider.enabled`.
  - `secretsCheck`: function that returns true when the new provider’s secrets are filled in `secrets`.
  - `browserUrls`: one or more URLs for the user to get the token.
  - `instructions`: array of short steps (log in, create key, copy, set in `.env.setup` as `KEY=...`, save).

### 5. Prerequisites (CLI / token)

- **`tooling/setup/infra/prerequisites.ts`** — If the new provider requires a CLI or token to be present:
  - Add an entry to `PREREQUISITES`: `command`, `versionFlag`, `enabledCheck` for the provider, and optionally `authCheck` and/or `tokenEnvKey` (e.g. `NEW_PROVIDER_TOKEN`) so token-based auth is supported without login.

### 6. Provider module (provision / check / deleteInstructions)

- **`tooling/setup/infra/providers/setup-<name>/setup-<name>.provider.ts`** — Create (or update) the provider module. Use `@tooling/setup/...` imports (no parent-relative `../`). Export at least:
  - `provision(config, secrets, state, environments): Promise<ProviderResult>`.
  - `check(state, secrets?, ...): Promise<boolean>` if the provider is health-checked.
  - On the exported `InfraProvider`: implement `deleteInstructions(context)` whenever the provider writes to `.setup-state.json`, returning the dashboard URL plus the identifiers the user must delete by hand. Never add `destroy` / `destroyEnvironment` — `setup:infra` does not delete resources.
- **`tooling/setup/infra/providers/index.ts`** — Add the new provider to `INFRA_PROVIDERS` (order matters).

### 7. State shape (for resources that persist)

- **`tooling/setup/common/state.ts`** — In `setupStateSchema`, add an optional key for the new provider (e.g. `newProvider: z.object({ projectId: z.string(), ... }).optional()`). Update `SetupState` type if needed (usually inferred from schema).
- **`tooling/setup/common/types.ts`** — Only if you add new top-level types for the provider; usually state is enough.

### 8. Build env vars (for GitHub environment secrets)

- **`tooling/setup/envs/build-env-vars.ts`** — If the new provider contributes variables to GitHub Actions environment secrets (e.g. `NEW_PROVIDER_API_KEY`), add the mapping in `buildEnvironmentVariables()` so those vars are passed to `githubProvider.provision`.

### 9. Documentation

- **`docs/deployment/setup/setup-token-instructions.md`**:
  - **Per-provider token instructions** table — Add row: Provider name, “Where to get token” (URL), “Variable in .env.setup”.
  - **Env-style (.env.setup) variable names** table — Add row: variable name(s), purpose.
  - If the provider is important for automation (like GITHUB_TOKEN), add or extend a **step-by-step** section with URL, scopes, and “set in .env.setup”.
- Run **docs-maintainer** if you added or moved docs; ensure `docs/README.md` still lists setup docs correctly.

### 10. Verify

- Run **`pnpm setup:infra:init`** (defaults should include the new provider if enabled by default).
- Run **`pnpm setup:infra:preview`** — new provider should appear in the list with correct URL and config key.
- Run **`pnpm typecheck`** and fix any type errors.
- Optionally run **`pnpm setup:infra`** in a test repo to confirm provisioning (or at least that the flow reaches the new step without error).

---

## Checklist: REMOVE a third-party provider

Reverse the steps above; remove or disable the provider everywhere.

1. **`tooling/setup/common/config.ts`** — Remove (or deprecate) the provider from `setupConfigSchema.providers`. If you keep the key for backward compatibility, set a default `enabled: false` and document deprecation.
2. **`tooling/setup/infra/init-wizard.ts`** — Remove or set `enabled: false` in `buildConfig()` for the provider. Remove the associated env-secrets entries (`TOKEN_URLS`, `SIMPLE_VARS`, `buildEnvSetupTemplateContent`, `appendMissingEnvSetupVariables`) from `tooling/setup/common/secrets.ts`.
3. **`tooling/setup/common/secrets.ts`** — Remove from `setupSecretsSchema` (or make optional and stop using). Also remove from `loadSecretsFromEnv` and `hasAnyEnvSecret`.
4. **`tooling/setup/infra/orchestrator.ts`** — Remove from any provider-specific summary lines in `runStatus`, env-state helpers, and the per-provider blocks in the post-provision summary. The provider’s `deleteInstructions` hook is removed automatically when its module is deleted.
5. **`tooling/setup/infra/guide.ts`** — Remove the corresponding step from `buildGuideSteps()`.
6. **`tooling/setup/infra/prerequisites.ts`** — Remove the prerequisite entry for that provider’s CLI/token.
7. **`tooling/setup/infra/providers/<name>.provider.ts`** — Delete the file and remove its import/usages from the orchestrator.
8. **`tooling/setup/common/state.ts`** — Remove the provider’s key from `setupStateSchema` (or leave optional and unused).
9. **`tooling/setup/envs/build-env-vars.ts`** — Remove any mapping that injected the provider’s vars into GitHub env secrets.
10. **`docs/deployment/setup/setup-token-instructions.md`** — Remove the provider from the per-provider table and env-style table; trim step-by-step section if it was the only one.
11. Run **`pnpm typecheck`** and **`pnpm setup:infra:preview`** to confirm nothing references the removed provider.

---

## File map (quick reference)

| Area                 | Files                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Config & init        | `tooling/setup/common/config.ts`, `tooling/setup/infra/init-wizard.ts`                   |
| Secrets & .env.setup | `tooling/setup/common/secrets.ts` (schema + load + hasAny + TOKEN_URLS/SIMPLE_VARS + template) |
| Orchestrator         | `tooling/setup/infra/orchestrator.ts`                                                     |
| Guide                | `tooling/setup/infra/guide.ts`                                                            |
| Prerequisites        | `tooling/setup/infra/prerequisites.ts`                                                    |
| Providers            | `tooling/setup/infra/providers/*.provider.ts`                                             |
| State & types        | `tooling/setup/common/state.ts`, `tooling/setup/common/types.ts`                         |
| Env vars for GitHub  | `tooling/setup/envs/build-env-vars.ts`                                                    |
| Docs                 | `docs/deployment/setup/setup-token-instructions.md`                                       |

---

## See also

- **setup-token-instructions.md** — User-facing token URLs and variable names.
- **skill-index** — Invoke this skill when you add/remove a third-party in setup:infra; invoke **docs-maintainer** if you add or move setup-related docs.
