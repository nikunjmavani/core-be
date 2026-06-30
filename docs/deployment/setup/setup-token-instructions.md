# Setup Token Instructions

Where to get each token and **which file to put it in**. Run `pnpm setup:infra:preview` for the checklist. Run `pnpm setup --init` to scaffold config + `.setup/.setup-credentials`.

---

## Two input files

| File | What goes here |
| ---- | -------------- |
| **`.setup/.setup-credentials`** | Account-wide setup-tooling tokens (Neon, AWS, Sentry, Resend, Railway, GitHub PAT) **plus per-environment Stripe keys** (`STRIPE_<ENV>_SECRET_KEY` / `_WEBHOOK_SECRET`) |
| **`.env.<environment>`** | Per-environment app secrets (OAuth, Postman, Scalar input) |

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

With `GITHUB_TOKEN` and `RAILWAY_API_TOKEN` set, no `gh auth login` or `railway login` is required.

---

## `.env.<environment>` (per environment)

| Provider | Keys you enter | What setup does |
| -------- | -------------- | --------------- |
| **Google OAuth** | `OAUTH_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Step-by-step guide (`setup-google-oauth`); app names `core-be-development`, `core-be` (production) |
| **GitHub OAuth** | `OAUTH_GITHUB_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Step-by-step guide (`setup-github-oauth`); same naming |
| **Turnstile** | `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET` | Validates via siteverify |
| **Postman** | `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID` | Uploads OpenAPI collection |
| **Scalar** | `SCALAR_API_KEY`, `SCALAR_NAMESPACE`, optional `SCALAR_SLUG` | Publishes to Scalar Registry |
| **PostHog** | `POSTHOG_PERSONAL_API_KEY` (optional `POSTHOG_PROJECT_ID` / `POSTHOG_PROJECT_API_KEY`) | **Generates** `POSTHOG_KEY` + `POSTHOG_HOST` |

Get links: [Stripe](https://dashboard.stripe.com/apikeys) · [Google OAuth](https://console.cloud.google.com/apis/credentials) · [GitHub OAuth](https://github.com/settings/developers) · [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) · [Postman](https://go.postman.co/settings/me/api-keys) · [Scalar](https://dashboard.scalar.com) · [PostHog](https://us.posthog.com/settings/user-api-keys)

---

## Init flow

1. **`pnpm setup --init`** → `setup.config.json` + `.setup/.setup-credentials` template.
2. Fill **`.setup/.setup-credentials`** with account-wide tokens (table above).
3. Fill **`.env.development`** / **`.env.production`** with per-env keys (table above). Run `pnpm setup:infra` — the interactive guide prints per-environment OAuth/Postman/Scalar steps.
4. **`pnpm setup:infra`** → provisions infra, resolves PostHog, validates Stripe/OAuth, writes/updates `.env.<environment>`.

---

## GITHUB_TOKEN — step-by-step

1. [GitHub → Personal access tokens](https://github.com/settings/tokens)
2. Classic: scopes `repo`, `admin:repo_hook` — or fine-grained with repo + Actions secrets write
3. In **`.setup/.setup-credentials`**: `GITHUB_TOKEN=<paste>`

---

## See Also

- [setup-automation.md](setup-automation.md) — full setup flow
- [SETUP_INFRA_PREREQUISITES.md](../../../tooling/setup/SETUP_INFRA_PREREQUISITES.md) — quick reference tables
