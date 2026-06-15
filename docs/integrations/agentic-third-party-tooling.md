# Agentic third-party tooling — CLI vs MCP vs SDK

How core-be talks to third-party services depends on **who the caller is**. CLI, MCP, and
SDK are not competing choices for the same slot — they serve three different consumers.
Pick by consumer, not by preference.

## Decision model (pick by consumer)

| Consumer | Where it lives | Use | Why |
| --- | --- | --- | --- |
| **Application runtime** | `src/**` (API + worker) | **SDK** | In-process, typed, deterministic, no shell-out. Already how we integrate every provider. |
| **CI/CD + scripts** | `.github/workflows/**`, `tooling/**`, `pnpm` scripts | **CLI** | Deterministic, returns exit codes, version-pinnable, auditable, no LLM/tokens/network-to-an-agent. |
| **Interactive AI agent** | Claude Code / Cursor sessions | **MCP** (preferred), else **CLI via shell** | Dynamic tool discovery, structured results, per-session scoped auth. Falls back to the CLI over Bash when no MCP exists. |

### Why MCP does **not** belong in code or CI/CD

An MCP server is a runtime protocol for an **LLM agent** to discover and call tools. In a
pipeline or in application code that is the wrong shape:

- **Non-deterministic** — there is a model in the loop; a gate that must pass/fail reliably
  cannot depend on one.
- **Needs an agent runtime + tokens + network** to reach it. A CLI is a pinned binary.
- **Not auditable/pinnable** like `semgrep==1.x` or a checksum-verified CLI.
- **Slower and flakier** than a direct CLI/SDK call.

So: **from code → SDK. From CI/CD → CLI. For the agent → MCP (CLI as fallback).** Your
instinct is right — for code and CI/CD the CLI (or SDK) is the correct tool, not MCP.

## Per-service mapping

✅ wired into `.mcp.example.json` · — not applicable / no peer server

| Service | Runtime (`src/`) → SDK | CI/CD + scripts → CLI | Interactive agent → MCP |
| --- | --- | --- | --- |
| **Neon / Postgres** | `postgres`, `drizzle-orm` | `drizzle-kit`, `psql`, `neonctl` | ✅ `mcp.neon.tech/mcp` |
| **Redis / BullMQ** | `ioredis`, `bullmq` | `redis-cli` | ✅ `redis/mcp-redis` (inspect queues/DLQ/idempotency/rate-limit keys live) |
| **AWS S3** | `@aws-sdk/client-s3` | `aws` | ✅ `mcp-proxy-for-aws` |
| **Stripe** | `stripe` | `stripe` (`listen` / `trigger` / `fixtures`) | ✅ `mcp.stripe.com` |
| **Resend** | `resend` | — (curl/API) | ✅ `mcp/resend` (Docker) |
| **Sentry** | `@sentry/node` | `sentry-cli` (releases/sourcemaps) | ✅ `mcp.sentry.dev/mcp` (+ Seer root-cause) |
| **GitHub** | Actions / Octokit | `gh` | — (removed; use `gh`) |
| **Railway** | — | `railway` (`redeploy`) | ✅ `@railway/mcp-server` |
| **SonarQube** | — | `sonar-scanner` (`pnpm sonar:scan`) | ✅ `mcp/sonarqube` (read findings + quality gate) |
| **Semgrep** | — | `semgrep` (`pnpm security:sast`) | ✅ `semgrep-mcp` (scan + structured findings) |
| **Gitleaks** | — | `gitleaks` (`pnpm security:secrets`) | — |
| **Postman** | — | Postman CLI / `newman` (`pnpm docs:upload`) | ✅ `mcp.postman.com/mcp` |
| **Cloudflare Turnstile** | fetch verify | `wrangler` | — no MCP (low value); scope TODO below |
| **Docker** | — | `docker` (`compose`, `buildx bake`) | — gateway only (Docker MCP Toolkit proxies servers, not a peer) |
| **Context7** (lib docs) | — | — | ✅ `@upstash/context7-mcp` |
| **codegraph** (code index) | — | `codegraph` | ✅ `codegraph serve --mcp` |

**Stripe is the canonical "all three" case:** the `stripe` SDK runs in the service, the
`stripe` CLI replays/triggers webhooks against the local `stripe-webhook` domain in dev/CI,
and the Stripe MCP lets an agent inspect test-mode objects. They coexist; none replaces another.

> **TODO (future scope):** Turnstile appears in the codebase only as server-side CAPTCHA token
> verification, and there's no agent MCP worth wiring (low value). Bringing **Turnstile / CAPTCHA
> hardening** into proper scope is parked here as a tracked future item — decision 2026-06-15:
> skip the agent MCP now, revisit the broader scope later.

## What the agent already has

The MCP servers in [`.mcp.example.json`](../../.mcp.example.json) (mirrored at
`agent-os/mcp/mcp.example.json`): **context7, core-be:api, neon, sentry, slack,
railway, aws, stripe, semgrep, sonarqube, redis, postman, resend, codegraph**. These are
*agent-only*; CI/CD and runtime do not use them.

## Agent MCP server notes (CI/CD keeps the CLIs)

None of these change CI/CD or runtime — Sonar/Semgrep still run as CLI gates, the app still
uses `ioredis` / `resend`. The MCP server only gives the **interactive agent** structured
access (read findings, inspect Redis, send a test email) instead of parsing CLI stdout over
Bash. The non-trivial local invocations:

```jsonc
"semgrep":   { "command": "uvx",    "args": ["semgrep-mcp"] },
"sonarqube": { "command": "docker", "args": ["run", "--init", "--pull=always", "--rm", "-i",
                                              "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_URL", "mcp/sonarqube"] },
"redis":     { "command": "uvx",    "args": ["--from", "redis-mcp-server@latest", "redis-mcp-server", "--url", "${REDIS_URL}"] },
"resend":    { "command": "docker", "args": ["run", "-i", "--rm", "-e", "RESEND_API_KEY", "mcp/resend"] }
```

Postman is a plain remote URL (`https://mcp.postman.com/mcp`; OAuth, or `Authorization: Bearer
<key>`). **Docker** is deliberately *not* a peer entry: "Docker MCP" is the **MCP
Toolkit/Gateway** (`docker mcp gateway run`) — an umbrella that proxies other MCP servers, not
a service to operate, so it sits *in front of* this list, not inside it.

> Endpoints and package names move fast — verify against each vendor's current docs before
> relying on a config. Sources: [Semgrep](https://github.com/semgrep/mcp),
> [SonarQube](https://github.com/SonarSource/sonarqube-mcp-server),
> [Redis](https://github.com/redis/mcp-redis),
> [Resend](https://github.com/resend/mcp-send-email),
> [Postman](https://learning.postman.com/docs/developer/postman-api/postman-mcp-server/set-up-postman-mcp-server),
> [Docker MCP](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/).

## Umbrella option — Composio

Composio is a single MCP layer over 500+ apps. It is an **alternative** to wiring each
vendor's first-party MCP, useful for cross-app glue (e.g. post Sonar findings to Slack/Notion).
Trade-off: one auth/governance plane vs. the deeper first-party tools (Sentry Seer, Stripe test
fixtures). For this backend, keep the first-party MCP servers above and reach for Composio only
for cross-app workflows.
