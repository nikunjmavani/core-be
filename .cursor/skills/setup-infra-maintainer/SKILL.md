---
name: setup-infra-maintainer
description: Keeps setup:infra third-party providers and all dependent files in sync. Use when adding or removing any provider (Neon, Upstash, AWS, Sentry, GitHub, Railway, Postman, Stripe, Resend, OAuth, etc.).
---

# Skill: Setup Infra Maintainer (core-be)

## Purpose

When you **add or remove a third-party provider** in the setup:infra flow (`pnpm setup:infra`, `setup --init`, `setup:infra:preview`), **every dependent file** must be updated in the same change. This skill is the checklist so nothing is missed.

## When to Use

- **Adding** a new third-party (e.g. new provider for secrets, DB, queue, or deploy).
- **Removing** an existing third-party from setup.
- **Renaming** or **changing the shape** of a provider (new secret keys, new config fields).

## Source of truth (provider list)

Current providers: **Neon**, **Upstash**, **AWS**, **Sentry**, **Resend**, **Stripe**, **OAuth (Google, GitHub)**, **Railway**, **GitHub** (repo/env secrets), **Postman**. Each appears in multiple places below; keep them in sync.

---

## Checklist: ADD a new third-party provider

Work through each section. Do not skip; missing any item will break init, preview, or provisioning.

### 1. Config schema and init defaults

- **`tooling/setup/config.ts`** — In `setupConfigSchema.providers`, add the new provider object (e.g. `enabled: z.boolean()`, plus any provider-specific fields: region, repository, fromAddress, etc.). Match the shape used in orchestrator and providers.
- **`tooling/setup/init-wizard.ts`** — In `buildConfig()`, add the new provider under `config.providers` with sensible defaults (e.g. `newProvider: { enabled: true, ... }`).

### 2. Secrets (env-style .env.setup)

- **`tooling/setup/secrets.ts`** — In `setupSecretsSchema`, add the new provider’s secret shape (e.g. `newProvider: z.object({ apiKey: z.string() })`).
- **`tooling/setup/env-secrets.ts`**:
  - **`TOKEN_URLS`** — Add `NEW_PROVIDER_API_KEY: 'https://...'` (URL where user gets the key).
  - **`SIMPLE_VARS`** — If the provider uses a single env var (or a fixed set), add `['NEW_PROVIDER_API_KEY', TOKEN_URLS.NEW_PROVIDER_API_KEY]` so the template and `appendMissingEnvSetupVariables` include it.
  - **`loadSecretsFromEnv`** — Add reading of the new key(s) from the env source and include them in the returned `SetupSecrets` object.
  - **`buildEnvSetupTemplateContent`** — If the provider uses more than the simple vars (e.g. per-env keys), add the corresponding blocks (comments + `KEY=` lines) after the existing loops.
  - **`appendMissingEnvSetupVariables`** — Already uses `SIMPLE_VARS`; if the new provider needs per-env vars, add a loop similar to Stripe (check existing keys, append missing blocks).
  - **`hasAnyEnvSecret`** — If the new provider’s secrets should count toward “any secret filled”, add a check for the new secret(s).

### 3. Orchestrator (preview, provisioning, check, status, update, rollback)

- **`tooling/setup/orchestrator.ts`**:
  - **`PREVIEW_PROVIDERS`** — Add an entry: `enabledCheck`, `provider` (display name), `detail`, `url`, `configKey` (e.g. `NEW_PROVIDER_API_KEY`).
  - **`displaySettingsReview`** — Add a block for the new provider (e.g. “NewProvider — 1 project” or “validate 1 key”).
  - **`checkForExistingResources`** — If the provider creates resources that should be detected (e.g. project name), add the check and push to `existing` when found.
  - **`runProvision`** — Add a provisioning step (load provider module, call `provision`, `applyStateUpdates`, push to `completedProviders` if it creates resources). Order: follow existing order (Neon, Upstash, AWS, Sentry, JWT, Resend, Stripe, OAuth, Railway, GitHub, …).
  - **`runCheck`** — Add health check for the new provider (call provider’s `check` when enabled and state exists).
  - **`runStatus`** — If the provider has per-env or shared state, add a line to the shared resources summary or env rows.
  - **`runUpdate`** — Only if the provider participates in “update” (e.g. re-sync secrets); GitHub does; most others don’t.
  - **No automated rollback / no script-side delete.** `setup:infra` never deletes resources and never rolls back on failure. Failures stop the run; the user removes any partial resources by hand using `pnpm setup:infra --delete`.
  - **`deleteInstructions(context)`** — If the provider records anything in `.setup-state.json`, implement this hook on the `InfraProvider`. Return one or more blocks `{ provider, dashboardUrl, steps?, resources: [{ label, identifier }] }` derived from state — these are rendered by `pnpm setup:infra --delete`. Do **not** add `destroy`/`destroyEnvironment` methods.

### 4. Guide (browser + instructions)

- **`tooling/setup/guide.ts`** — In `buildGuideSteps()`, add a new step:
  - `providerName`: display name (e.g. “NewProvider”).
  - `enabledCheck`: `(config) => config.providers.newProvider.enabled`.
  - `secretsCheck`: function that returns true when the new provider’s secrets are filled in `secrets`.
  - `browserUrls`: one or more URLs for the user to get the token.
  - `instructions`: array of short steps (log in, create key, copy, set in `.env.setup` as `KEY=...`, save).

### 5. Prerequisites (CLI / token)

- **`tooling/setup/prerequisites.ts`** — If the new provider requires a CLI or token to be present:
  - Add an entry to `PREREQUISITES`: `command`, `versionFlag`, `enabledCheck` for the provider, and optionally `authCheck` and/or `tokenEnvKey` (e.g. `NEW_PROVIDER_TOKEN`) so token-based auth is supported without login.

### 6. Provider module (provision / check / deleteInstructions)

- **`tooling/setup/infra/providers/setup-<name>/setup-<name>.provider.ts`** — Create (or update) the provider module. Export at least:
  - `provision(config, secrets, state, environments): Promise<ProviderResult>`.
  - `check(state, secrets?, ...): Promise<boolean>` if the provider is health-checked.
  - On the exported `InfraProvider`: implement `deleteInstructions(context)` whenever the provider writes to `.setup-state.json`, returning the dashboard URL plus the identifiers the user must delete by hand. Never add `destroy` / `destroyEnvironment` — `setup:infra` does not delete resources.
- **`tooling/setup/infra/providers/index.ts`** — Add the new provider to `INFRA_PROVIDERS` (order matters).

### 7. State shape (for resources that persist)

- **`tooling/setup/state.ts`** — In `setupStateSchema`, add an optional key for the new provider (e.g. `newProvider: z.object({ projectId: z.string(), ... }).optional()`). Update `SetupState` type if needed (usually inferred from schema).
- **`tooling/setup/types.ts`** — Only if you add new top-level types for the provider; usually state is enough.

### 8. Build env vars (for GitHub environment secrets)

- **`tooling/setup/build-env-vars.ts`** — If the new provider contributes variables to GitHub Actions environment secrets (e.g. `NEW_PROVIDER_API_KEY`), add the mapping in `buildEnvironmentVariables()` so those vars are passed to `githubProvider.provision`.

### 9. Documentation

- **`docs/deployment/setup/setup-token-instructions.md`**:
  - **Per-provider token instructions** table — Add row: Provider name, “Where to get token” (URL), “Variable in .env.setup”.
  - **Env-style (.env.setup) variable names** table — Add row: variable name(s), purpose.
  - If the provider is important for automation (like GITHUB_TOKEN), add or extend a **step-by-step** section with URL, scopes, and “set in .env.setup”.
- Run **docs-maintainer** if you added or moved docs; ensure `docs/README.md` still lists setup docs correctly.

### 10. Verify

- Run **`pnpm setup --init`** (defaults should include the new provider if enabled by default).
- Run **`pnpm setup:infra:preview`** — new provider should appear in the list with correct URL and config key.
- Run **`pnpm typecheck`** and fix any type errors.
- Optionally run **`pnpm setup:infra`** in a test repo to confirm provisioning (or at least that the flow reaches the new step without error).

---

## Checklist: REMOVE a third-party provider

Reverse the steps above; remove or disable the provider everywhere.

1. **`tooling/setup/config.ts`** — Remove (or deprecate) the provider from `setupConfigSchema.providers`. If you keep the key for backward compatibility, set a default `enabled: false` and document deprecation.
2. **`tooling/setup/init-wizard.ts`** — Remove or set `enabled: false` in `buildConfig()` for the provider.
3. **`tooling/setup/secrets.ts`** — Remove from `setupSecretsSchema` (or make optional and stop using).
4. **`tooling/setup/env-secrets.ts`** — Remove from `TOKEN_URLS`, `SIMPLE_VARS`, `loadSecretsFromEnv`, `buildEnvSetupTemplateContent`, `appendMissingEnvSetupVariables`, `hasAnyEnvSecret` as applicable.
5. **`tooling/setup/infra/orchestrator.ts`** — Remove from any provider-specific summary lines in `runStatus`, env-state helpers, and the per-provider blocks in the post-provision summary. The provider's `deleteInstructions` hook is removed automatically when its module is deleted.
6. **`tooling/setup/guide.ts`** — Remove the corresponding step from `buildGuideSteps()`.
7. **`tooling/setup/prerequisites.ts`** — Remove the prerequisite entry for that provider’s CLI/token.
8. **`tooling/setup/providers/<name>.provider.ts`** — Delete the file and remove its import/usages from the orchestrator.
9. **`tooling/setup/state.ts`** — Remove the provider’s key from `setupStateSchema` (or leave optional and unused).
10. **`tooling/setup/build-env-vars.ts`** — Remove any mapping that injected the provider’s vars into GitHub env secrets.
11. **`docs/deployment/setup/setup-token-instructions.md`** — Remove the provider from the per-provider table and env-style table; trim step-by-step section if it was the only one.
12. Run **`pnpm typecheck`** and **`pnpm setup:infra:preview`** to confirm nothing references the removed provider.

---

## File map (quick reference)

| Area                 | Files                                                      |
| -------------------- | ---------------------------------------------------------- |
| Config & init        | `tooling/setup/config.ts`, `tooling/setup/init-wizard.ts`  |
| Secrets & .env.setup | `tooling/setup/secrets.ts`, `tooling/setup/env-secrets.ts` |
| Orchestrator         | `tooling/setup/orchestrator.ts`                            |
| Guide                | `tooling/setup/guide.ts`                                   |
| Prerequisites        | `tooling/setup/prerequisites.ts`                           |
| Providers            | `tooling/setup/providers/*.provider.ts`                    |
| State & types        | `tooling/setup/state.ts`, `tooling/setup/types.ts`         |
| Env vars for GitHub  | `tooling/setup/build-env-vars.ts`                          |
| Docs                 | `docs/deployment/setup/setup-token-instructions.md`        |

---

## See also

- **setup-token-instructions.md** — User-facing token URLs and variable names.
- **skill-index** — Invoke this skill when you add/remove a third-party in setup:infra; invoke **docs-maintainer** if you add or move setup-related docs.
