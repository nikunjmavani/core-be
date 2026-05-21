# Setup Token Instructions

Where to get each token and where to put it. Run `pnpm setup:infra:preview` to see the list and config. Run `pnpm setup:infra:init` to generate config and an env-style template interactively.

---

## Token-only automation (no CLI login)

Setup uses **tokens from `.env.setup`** only — no `gh auth login` or `railway login` required. If `GITHUB_TOKEN` and/or `RAILWAY_TOKEN` are set in `.env.setup`, the prerequisite check treats you as authenticated and provisioning uses those tokens (GitHub via `gh` with the token, Railway via API). Fill all required keys in `.env.setup` and run `pnpm setup:infra`; the guide and provisioning run without interactive login.

---

## Init and GitHub token

1. Run **`pnpm setup:infra:init`** to generate `tooling/setup.config.json` and `.env.setup` (template with URLs for each key). Init also asks for **Neon Organization ID** — get it from [Neon Console → Settings](https://console.neon.tech/app/settings) → select your **Organization** → **General** → **Organization ID** (e.g. `org-soft-block-10705736`). If you enter it, init writes it to `.env.setup` as `NEON_ORG_ID`. If either file already exists, init does not erase existing values; it only updates the header and prompt defaults from existing config.
2. Fill **`.env.setup`** with your API keys. For automation (CI or headless), include at least:
   - **`GITHUB_TOKEN`** — [GitHub → Personal access tokens](https://github.com/settings/tokens) (scopes: `repo`, `admin:repo_hook`, or fine-grained with repo + secrets). Required if GitHub provider is enabled (repo/env secrets).
   - **`RAILWAY_TOKEN`** — [Railway → Tokens](https://railway.app/account/tokens). Required if Railway provider is enabled.
3. Run **`pnpm setup:infra`** for full provisioning. No `gh auth login` or `railway login` needed when these tokens are set.

---

## Config and secrets

- **Config:** `tooling/setup.config.json` — which providers and environments. Generate with `pnpm setup:infra:init` (asks org, project, envs, and Neon Organization ID).
- **Secrets:** `.env.setup` at project root — one `KEY=value` per line. Each variable has a comment above it with the **URL where to get the key**. Gitignored. You can also `export NEON_API_KEY=...` etc. and run `pnpm setup:infra`; process.env is merged with `.env.setup`.
- **Per-environment files:** After provisioning, setup writes `.env.<environment>` (e.g. `.env.dev`, `.env.production`) with all app env vars for that environment. Use these to push values to GitHub Environment secrets (structure matches `.env.example`). Run `pnpm setup:infra:export-env` to regenerate anytime.

---

## Double confirm before provisioning

When you run `pnpm setup:infra`, you will see:

1. **Settings review** — which third parties will be provisioned
2. **First confirm** — "Are these settings correct?" (y/N)
3. **Second confirm** — "FINAL CONFIRMATION: Proceed with provisioning? This will create REAL resources." (y/N)

Only after both confirms will provisioning run. You can abort at any time.

---

## Per-provider token instructions

| Provider                          | Where to get token                                                                                                                                                                                                              | Variable in .env.setup                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Neon Postgres**                 | [console.neon.tech → API Keys](https://console.neon.tech/app/settings/api-keys); optional: [Organization → General](https://console.neon.tech/app/settings) for `NEON_ORG_ID` if create project fails with "org_id is required" | `NEON_API_KEY`, optional `NEON_ORG_ID`                   |
| **Upstash Redis**                 | [Upstash Console](https://console.upstash.com/) — create a Redis database, copy the URL                                                                                                                                         | `UPSTASH_REDIS_URL`                                      |
| **AWS IAM**                       | [AWS IAM → Users → Create access key](https://console.aws.amazon.com/iam/home#/users)                                                                                                                                           | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`             |
| **Sentry**                        | [sentry.io → Auth Tokens](https://sentry.io/settings/auth-tokens/new-token/)                                                                                                                                                    | `SENTRY_AUTH_TOKEN`                                      |
| **Resend**                        | [resend.com → API Keys](https://resend.com/api-keys)                                                                                                                                                                            | `RESEND_API_KEY`                                         |
| **GitHub (for repo/env secrets)** | [GitHub → Personal access tokens](https://github.com/settings/tokens)                                                                                                                                                           | `GITHUB_TOKEN`                                           |
| **Stripe**                        | [Stripe Dashboard → API Keys](https://dashboard.stripe.com/apikeys)                                                                                                                                                             | `STRIPE_<ENV>_SECRET_KEY`, `STRIPE_<ENV>_WEBHOOK_SECRET` |
| **Google OAuth**                  | [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials)                                                                                                                                                 | `OAUTH_GOOGLE_<ENV>_CLIENT_ID`, etc.                     |
| **GitHub OAuth**                  | [GitHub → OAuth Apps](https://github.com/settings/developers)                                                                                                                                                                   | `OAUTH_GITHUB_<ENV>_CLIENT_ID`, etc.                     |
| **Railway**                       | [railway.app → Tokens](https://railway.app/account/tokens)                                                                                                                                                                      | `RAILWAY_TOKEN`                                          |
| **Postman**                       | [Postman → API Keys](https://go.postman.co/settings/me/api-keys), [Workspaces](https://go.postman.co/workspaces)                                                                                                                | `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID`                |

`<env>` = `dev`, `qa`, or `prod` (per environment).

---

## GITHUB_TOKEN — step-by-step

Required for writing repository and environment secrets (GitHub provider). No `gh auth login` needed when set in `.env.setup`.

1. Open **[GitHub → Personal access tokens](https://github.com/settings/tokens)** (Settings → Developer settings → Personal access tokens).
2. Click **“Generate new token”** (classic) or create a **fine-grained** token.
3. **Scopes:** For classic: enable `repo` and `admin:repo_hook`. For fine-grained: select the repository and **Actions: Secrets** (read + write).
4. Generate the token and copy it.
5. In **`.env.setup`** at project root, set:  
   `GITHUB_TOKEN=<paste-your-token-here>`
6. Save the file. Run `pnpm setup:infra`; the script will use this token to set repo and environment secrets.

---

## Env-style (.env.setup) variable names

If you use `.env.setup` or export env vars, use these names (script maps them internally):

| Variable                                                          | Purpose                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `NEON_API_KEY`                                                    | Neon Postgres API key                                                        |
| `UPSTASH_REDIS_URL`                                               | Upstash Redis URL (from console.upstash.com)                                 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                      | AWS IAM                                                                      |
| `SENTRY_AUTH_TOKEN`                                               | Sentry                                                                       |
| `RESEND_API_KEY`                                                  | Resend                                                                       |
| `GITHUB_TOKEN`                                                    | GitHub personal access token (repo/env secrets; no `gh auth login` when set) |
| `RAILWAY_TOKEN`                                                   | Railway (no `railway login` when set; API-only)                              |
| `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID`                         | Postman                                                                      |
| `STRIPE_<ENV>_SECRET_KEY`, `STRIPE_<ENV>_WEBHOOK_SECRET`          | Stripe per env (e.g. `STRIPE_DEV_SECRET_KEY`)                                |
| `OAUTH_GOOGLE_<ENV>_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` | Google OAuth per env                                                         |
| `OAUTH_GITHUB_<ENV>_CLIENT_ID`, etc.                              | GitHub OAuth per env                                                         |

---

## See Also

- [setup-automation.md](setup-automation.md) — full setup flow
- [cicd-and-deployment.md](../ci-cd/cicd-and-deployment.md) — deploy after infra is ready
