# Setup Token Instructions

Where to get each token and **which file to put it in**. The `setup:*` provisioning commands below run from the companion **`core-infra`** repo. Run `pnpm setup:infra:preview` for the checklist. Run `pnpm setup --init` to scaffold config + `.setup/.setup-credentials`.

---

## Two input files

| File | What goes here |
| ---- | -------------- |
| **`.setup/.setup-credentials`** | Account-wide setup-tooling tokens (Neon, AWS, Sentry, Resend, Railway, GitHub PAT, Cloudflare, Postman, Scalar, PostHog) |
| **`.env.<environment>`** | Per-environment app secrets entered at apply (Stripe, OAuth input) |

Setup **generates** outputs into `.env.<environment>` (e.g. `DATABASE_URL`, `POSTHOG_KEY`, `SENTRY_DSN`) — you do not enter those by hand.

---

## `.setup/.setup-credentials` (setup-tooling only)

| Provider | Where to get token | Variable(s) |
| -------- | ------------------ | ----------- |
| **Neon Postgres** | [API Keys](https://console.neon.tech/app/settings/api-keys); optional [Org ID](https://console.neon.tech/app/settings) | `NEON_API_KEY`, optional `NEON_ORG_ID` |
| **AWS IAM** | [IAM → Create access key](https://console.aws.amazon.com/iam/home#/users) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| **Sentry** | [Auth Tokens](https://sentry.io/settings/auth-tokens/new-token/) | `SENTRY_AUTH_TOKEN` |
| **Resend** | [API Keys](https://resend.com/api-keys) | `RESEND_API_KEY` |
| **Railway** | [Account tokens](https://railway.com/account/tokens) | `RAILWAY_API_TOKEN` |
| **GitHub** (repo/env secrets) | [Personal access tokens](https://github.com/settings/tokens) | `GITHUB_TOKEN` |
| **Cloudflare Turnstile** | [API tokens (Turnstile:Edit)](https://dash.cloudflare.com/profile/api-tokens) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **Postman** | [API Keys](https://go.postman.co/settings/me/api-keys) | `POSTMAN_API_KEY` |
| **Scalar** | [API Keys](https://dashboard.scalar.com) | `SCALAR_API_KEY` (optional `SCALAR_NAMESPACE` / `SCALAR_SLUG`) |
| **PostHog** | [Personal API Keys](https://us.posthog.com/settings/user-api-keys) | `POSTHOG_PERSONAL_API_KEY` (optional `POSTHOG_PROJECT_ID` / `POSTHOG_PROJECT_API_KEY`) |

With `GITHUB_TOKEN` and `RAILWAY_API_TOKEN` set, no `gh auth login` or `railway login` is required. Setup **provisions** Turnstile from `CLOUDFLARE_*` (one widget per env → `CAPTCHA_SITE_KEY`/`CAPTCHA_SECRET`) and creates the Postman workspace + a per-environment collection (`<project>-<env>`) from `POSTMAN_API_KEY` (→ `POSTMAN_WORKSPACE_ID`), writing those outputs into each `.env.<environment>`. Scalar publishes a per-environment registry doc (slug `<project>-<env>`).

---

## `.env.<environment>` (per environment)

Prompted at apply (stdin) and written into the matching `.env.<environment>`.

| Provider | Keys you enter | What setup does |
| -------- | -------------- | --------------- |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | **Pure guide (Dashboard only) — no API calls, reads nothing from `.env`.** **dev:** Sandboxes → create → API keys → copy `sk_/pk_test_…`. **prod:** live Dashboard → API keys → copy `sk_/pk_live_…`. **webhook:** Developers → Webhooks → add endpoint `…/api/v1/billing/webhook` → copy signing secret (`stripe listen` for local). Paste all three per env |
| **Google OAuth** | `OAUTH_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Step-by-step guide (`setup-google-oauth`); app names `core-be-development`, `core-be` (production) |
| **GitHub sign-in (GitHub App)** | `OAUTH_GITHUB_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | **Creates a GitHub App** via the manifest flow (one browser click → credentials returned, no paste); one app, all envs; guided-paste fallback |

Get links: [Stripe](https://dashboard.stripe.com/apikeys) · [Google OAuth](https://console.cloud.google.com/apis/credentials) · [GitHub OAuth](https://github.com/settings/developers) · [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) · [Postman](https://go.postman.co/settings/me/api-keys) · [Scalar](https://dashboard.scalar.com) · [PostHog](https://us.posthog.com/settings/user-api-keys)

---

## Init flow

1. **`pnpm setup --init`** (in `core-infra`) → `setup.config.json` + `.setup/.setup-credentials` template.
2. Fill **`.setup/.setup-credentials`** with account-wide tokens (table above).
3. Fill **`.env.development`** / **`.env.production`** with per-env keys (table above). Run `pnpm setup:infra` — the interactive guide prints per-environment Stripe/OAuth steps.
4. **`pnpm setup:infra`** → provisions infra, resolves PostHog, validates Stripe/OAuth, writes/updates `.env.<environment>`.

---

## Getting the values back out

- **Full backend env (pasteable):** `pnpm setup:infra:output --environment <env> --copy-all` copies the entire `.env.<env>` to your clipboard (auto-clears; never printed to the terminal). `--copy <KEY>` copies one value; bare `setup:infra:output` shows a masked inventory.
- **Frontend (core-fe) keys:** `pnpm setup:infra:frontend --environment <env>` prints the browser-safe bundle (`SENTRY_FRONTEND_DSN`, `POSTHOG_KEY`/`HOST`, `STRIPE_PUBLISHABLE_KEY`, `CAPTCHA_SITE_KEY`). Add `--vite` for core-fe's exact names (`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`/`HOST`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`). These are all public, so they print directly — paste straight into core-fe's env file.

---

## GITHUB_TOKEN — step-by-step

1. [GitHub → Personal access tokens](https://github.com/settings/tokens)
2. Classic: scopes `repo`, `admin:repo_hook` — or fine-grained with repo + Actions secrets write
3. In **`.setup/.setup-credentials`**: `GITHUB_TOKEN=<paste>`

---

## See Also

- [setup-automation.md](setup-automation.md) — full setup flow
- `SETUP_INFRA_PREREQUISITES.md` (in the standalone **core-infra** repo) — quick reference tables
