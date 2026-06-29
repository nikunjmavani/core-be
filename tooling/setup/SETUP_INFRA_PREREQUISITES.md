# Setup-infra prerequisites — credentials you must provide

These are the **inputs you obtain from each provider and put in `.setup/.setup-credentials`** before
running `pnpm setup:infra`. Fill only the providers that are `enabled: true` in
`tooling/setup/setup.config.json`.

> This list is **only what you supply**. Everything setup *derives or generates* (DSNs,
> connection strings, project keys, JWT keys, per-env Railway tokens)
> is written into `.env.<environment>` for you — see "What setup generates" below. Do **not**
> put those in `.setup/.setup-credentials`.

Authoritative source: each provider's `preview()` (run `pnpm setup:infra:preview`) and the
secret schema in `tooling/setup/common/secrets.ts`.

## What you put in `.setup/.setup-credentials`

| Provider | What you provide | `.setup/.setup-credentials` variable(s) | Where to get it |
| --- | --- | --- | --- |
| **Neon Postgres** | API key (+ org id only if "org_id required") | `NEON_API_KEY` · optional `NEON_ORG_ID` | https://console.neon.tech/app/settings/api-keys |
| **AWS S3** | IAM access key pair | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | https://console.aws.amazon.com/iam/home#/users → Create access key |
| **Sentry** | Auth token | `SENTRY_AUTH_TOKEN` | https://sentry.io/settings/auth-tokens/new-token/ |
| **Resend** | API key | `RESEND_API_KEY` | https://resend.com/api-keys |
| **PostHog** | Personal API key (resolves the project key for you) | `POSTHOG_PERSONAL_API_KEY` · optional `POSTHOG_PROJECT_ID` / `POSTHOG_PROJECT_API_KEY` | https://us.posthog.com/settings/user-api-keys |
| **Railway** (server **+ Redis**) | Account/project-wide token — **one token covers both** | `RAILWAY_API_TOKEN` | https://railway.com/account/tokens |
| **GitHub** (repo/env secrets) | Personal access token | `GITHUB_TOKEN` | https://github.com/settings/tokens |
| **Postman** | API key + workspace id | `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID` | https://go.postman.co/settings/me/api-keys · workspace id from the workspace URL |
| **Scalar** | API key + namespace (+ optional slug) | `SCALAR_API_KEY`, `SCALAR_NAMESPACE` · optional `SCALAR_SLUG` | https://dashboard.scalar.com → Settings → API keys |
| **JWT secrets** | — nothing — | — | n/a (generated locally; no provider account) |

**Every key here is account-wide / env-agnostic** — no `<ENV>` suffix. The environment
dimension belongs to the `.env.<environment>` file, not the key name.

## App per-environment secrets — set these in `.env.<environment>` (NOT in setup credentials)

Stripe, OAuth, and Turnstile differ per environment, so they live directly in
`.env.development` / `.env.production` (plain keys, no `<ENV>` suffix). Their `setup:infra`
providers **validate** them by reading each env file.

| Provider | `.env.<environment>` keys | Where to get it |
| --- | --- | --- |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test keys in dev, live in prod) | https://dashboard.stripe.com/apikeys |
| **OAuth – Google** | `OAUTH_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | https://console.cloud.google.com/apis/credentials |
| **OAuth – GitHub** | `OAUTH_GITHUB_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | https://github.com/settings/developers → OAuth Apps |
| **Cloudflare Turnstile** | `CAPTCHA_PROVIDER=turnstile`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET` | https://dash.cloudflare.com/?to=/:account/turnstile |

## What setup generates (do NOT put these in `.setup/.setup-credentials`)

Setup creates/derives these and writes them into each `.env.<environment>` — they are
**outputs**, not prerequisites:

| Generated value | Comes from |
| --- | --- |
| `DATABASE_URL`, `DATABASE_MIGRATION_URL` | Neon project/branch provisioning |
| `REDIS_URL` | Railway Redis provisioning |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | AWS bucket + scoped IAM user setup creates |
| `SENTRY_DSN` | Sentry project setup creates/adopts |
| `POSTHOG_KEY`, `POSTHOG_HOST` | resolved from `POSTHOG_PERSONAL_API_KEY` |
| `RAILWAY_TOKEN` (per-env) | minted from `RAILWAY_API_TOKEN` |
| `JWT_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_SIGNING_KID`, `SECRETS_ENCRYPTION_KEY` | generated locally by the JWT provider |

## Notes

- All inputs live in **`.setup/.setup-credentials`** (gitignored). Each line has its get-it URL as a
  comment; `pnpm setup:infra:init` scaffolds the file.
- **Railway server + Railway Redis share `RAILWAY_API_TOKEN`** — one token, no double entry.
- **Token-only auth**: with `GITHUB_TOKEN` and `RAILWAY_API_TOKEN` set, no `gh auth login`
  / `railway login` is needed.
- Verify what each enabled provider still needs: `pnpm setup:infra:preview`. Check what
  exists vs your config: `pnpm setup:infra:inspect`.
- Full step-by-step (incl. GitHub PAT scopes): `docs/deployment/setup/setup-token-instructions.md`.
