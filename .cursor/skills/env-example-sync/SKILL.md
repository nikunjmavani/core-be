---
name: env-example-sync
description: Keep .env.example and .env.local.example in sync with the env schema; when env vars are added or removed, update the example files and provide a PR description snippet for env changes.
---

# Env Example Sync

Run this skill when **any** of the following change:

- **Env schema**: `src/shared/config/env-schema.ts` (new or removed env vars in the Zod schema)
- **Example files**: `.env.example` or `.env.local.example` (manual edits that should stay aligned with the schema)

## What to do

### 1. Sync example files with the schema

- **Source of truth**: `src/shared/config/env-schema.ts` — the Zod `envSchema` defines required and optional env vars. The script uses `envSchemaKeys` exported from that file.
- Run: **`pnpm tool:sync-env-example`** to report added/removed vars for **both** `.env.example` and `.env.local.example`, and print a PR description snippet.
- If the script reports **missing vars**, run **`pnpm tool:sync-env-example --fix`** to append `# KEY=` lines for new keys to any file that is missing them. Then edit `.env.example` to add short descriptions or example values where needed.
- If the script reports **removed vars** (uncommented `KEY=` in an example file but not in schema), remove those lines or add them to the env schema.

### 2. Decide which vars are required for deploy (commented vs uncommented)

- **Rule:** In **`.env.example`**, any **uncommented** `KEY=VALUE` line is treated as **required for deploy** to dev/qa/prod — `pnpm validate:github-env` enforces that they exist in GitHub environment secrets.
- **`.env.local.example`**: may include uncommented lines for common local defaults; keep deploy-required keys **only** in `.env.example` unless you intentionally want GitHub validation to require them (usually keep local template keys as comments except for safe placeholders like `NODE_ENV=local`).
- **When new env vars are added** to the schema or `.env.example`, **ask the user explicitly** which of the new keys should be:
  - **Uncommented** in `.env.example` (required for deploy), or
  - **Commented out** (optional / nice-to-have for deploy).
- After the user answers:
  - Ensure **deploy-required** keys are **uncommented** `KEY=placeholder` lines in `.env.example`.
  - Ensure **optional** keys remain **commented** (`# KEY=...`) with a brief comment if helpful.
- Keep this aligned with `docs/deployment/ci-cd/cicd-and-deployment.md` so that required deploy vars match what `validate:github-env` enforces.

### 3. PR description snippet

- The script prints a block: **"--- Copy below into PR description ---"** with a short **"## Environment variable changes"** section (Added / Removed).
- **Paste that block into the PR description** so reviewers and deploy docs (e.g. GitHub, Railway) can see env changes at a glance.
- GitHub does not auto-fill PR descriptions; this skill provides the snippet for the author (or AI) to add manually. When adding deploy vars, ensure they are added to GitHub environment secrets (dev, qa, production) and to the deploy workflow's "Set Railway service variables" step.

### 4. Optional: CI check

- CI runs `pnpm tool:sync-env-example` (no `--fix`). If the script exits non-zero, the job fails and the author must run `--fix` and commit, or remove obsolete vars from the example files.

## Checklist

- [ ] After changing `env-schema.ts`, run `pnpm tool:sync-env-example` (and `--fix` if needed).
- [ ] Every env schema key appears in **both** `.env.example` and `.env.local.example` (commented or uncommented). **Uncommented** `KEY=` lines in `.env.example` must be in the schema (deploy-required). Commented `# KEY=` lines may be schema optional vars or tooling-only keys not in the schema (e.g. `POSTMAN_API_KEY`).
- [ ] For any new env keys in `.env.example`, you confirmed with the user which ones are **required for deploy** (uncommented) vs **optional** (commented).
- [ ] PR description includes the "Environment variable changes" snippet when env vars were added or removed.

## Reference

- **`src/shared/config/env-schema.ts`** — env schema and `envSchemaKeys`.
- **`.env.example`** — non-comment `KEY=VALUE` lines represent env vars that must exist in GitHub environment secrets for deploy; keep this aligned with the schema and deployment docs (`docs/deployment/ci-cd/cicd-and-deployment.md`).
- **`.env.local.example`** — template for `.env.local` (loaded after `.env` at runtime; see `src/shared/config/load-env-files.ts`).
