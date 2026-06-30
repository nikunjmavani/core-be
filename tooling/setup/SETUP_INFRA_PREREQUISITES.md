# Setup-infra prerequisites — credentials you must provide

Fill only the providers that are `enabled: true` in `tooling/setup/setup.config.json`.

> **Two input files.** Account-wide **setup-tooling** tokens go in `.setup/.setup-credentials`.
> Per-environment **app** secrets go in `.env.development` / `.env.production`. Setup *derives*
> outputs (DSNs, `POSTHOG_KEY`, JWT keys, per-env `RAILWAY_TOKEN`) into `.env.<environment>` —
> do not put those in `.setup/.setup-credentials`.

Authoritative source: `pnpm setup:infra:preview` and `tooling/setup/common/secrets.ts`.

## What you put in `.setup/.setup-credentials`

| Provider | What you provide | Variable(s) | Where to get it |
| --- | --- | --- | --- |
| **Neon Postgres** | API key (+ org id if required) | `NEON_API_KEY` · optional `NEON_ORG_ID` | https://console.neon.tech/app/settings/api-keys |
| **AWS S3** | IAM access key pair | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | https://console.aws.amazon.com/iam/home#/users |
| **Sentry** | Auth token | `SENTRY_AUTH_TOKEN` | https://sentry.io/settings/auth-tokens/new-token/ |
| **Resend** | API key | `RESEND_API_KEY` | https://resend.com/api-keys |
| **Railway** (server **+ Redis**) | Account/project-wide token | `RAILWAY_API_TOKEN` | https://railway.com/account/tokens |
| **GitHub** (repo/env secrets) | Personal access token | `GITHUB_TOKEN` | https://github.com/settings/tokens |
| **Stripe** (per environment) | Secret + webhook keys | `STRIPE_<ENV>_SECRET_KEY`, `STRIPE_<ENV>_WEBHOOK_SECRET` | https://dashboard.stripe.com/apikeys · /webhooks |
| **JWT secrets** | — nothing — | — | n/a (generated locally) |

Setup validates the per-environment Stripe keys and writes `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` into each `.env.<environment>`.

## What you put in `.env.<environment>` (per environment file)

| Provider | Keys you enter | What setup does |
| --- | --- | --- |
| **Google OAuth** | `OAUTH_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Step-by-step guide + validate (app name: `core-be-development`, `core-be` for production) |
| **GitHub OAuth** | `OAUTH_GITHUB_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Step-by-step guide + validate (same naming) |
| **Cloudflare Turnstile** | `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET` | Validates only |
| **Postman** | `POSTMAN_API_KEY`, `POSTMAN_WORKSPACE_ID` | Uploads collection (reads from default env) |
| **Scalar** | `SCALAR_API_KEY`, `SCALAR_NAMESPACE`, optional `SCALAR_SLUG` | Publishes OpenAPI (reads from default env) |
| **PostHog** | `POSTHOG_PERSONAL_API_KEY` (optional `POSTHOG_PROJECT_ID` / `POSTHOG_PROJECT_API_KEY`) | **Resolves** `POSTHOG_KEY` + `POSTHOG_HOST` for you |

## What setup generates (outputs — do NOT hand-enter)

| Generated value | Comes from |
| --- | --- |
| `DATABASE_URL`, `DATABASE_MIGRATION_URL` | Neon provisioning |
| `REDIS_URL` | Railway Redis provisioning |
| `S3_*` | AWS bucket + IAM user |
| `SENTRY_DSN` | Sentry project create/adopt |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Resolved from `POSTHOG_PERSONAL_API_KEY` in `.env.<environment>` |
| `RAILWAY_TOKEN` (per-env) | Minted from `RAILWAY_API_TOKEN` |
| `JWT_*`, `SECRETS_ENCRYPTION_KEY` | Generated locally |

## Notes

- Run `pnpm setup:infra` — the interactive guide opens browsers and prints per-env steps.
- **Token-only auth**: `GITHUB_TOKEN` + `RAILWAY_API_TOKEN` in `.setup-credentials` — no `gh auth login` / `railway login`.
- Full detail: `docs/deployment/setup/setup-token-instructions.md`.
