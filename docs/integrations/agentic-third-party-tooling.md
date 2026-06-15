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

✅ already wired · ➕ recommended add · — not applicable / none worth it

| Service | Runtime (`src/`) → SDK | CI/CD + scripts → CLI | Interactive agent → MCP |
| --- | --- | --- | --- |
| **Neon / Postgres** | `postgres`, `drizzle-orm` | `drizzle-kit`, `psql`, `neonctl` | ✅ `mcp.neon.tech/mcp` |
| **Redis / BullMQ** | `ioredis`, `bullmq` | `redis-cli` | ➕ `redis/mcp-redis` (inspect queues/DLQ/idempotency/rate-limit keys live) |
| **AWS S3** | `@aws-sdk/client-s3` | `aws` | ✅ `mcp-proxy-for-aws` |
| **Stripe** | `stripe` | `stripe` (`listen` / `trigger` / `fixtures`) | ✅ `mcp.stripe.com` |
| **Resend** | `resend` | — (curl/API) | ➕ optional: `resend/mcp-send-email` |
| **Sentry** | `@sentry/node` | `sentry-cli` (releases/sourcemaps) | ✅ `mcp.sentry.dev/mcp` (+ Seer root-cause) |
| **GitHub** | Actions / Octokit | `gh` | ✅ `api.githubcopilot.com/mcp/` |
| **Railway** | — | `railway` (`redeploy`) | ✅ `@railway/mcp-server` |
| **SonarQube** | — | `sonar-scanner` (`pnpm sonar:scan`) | ➕ `mcp/sonarqube` (read findings + quality gate) |
| **Semgrep** | — | `semgrep` (`pnpm security:sast`) | ➕ `semgrep-mcp` (scan + structured findings) |
| **Gitleaks** | — | `gitleaks` (`pnpm security:secrets`) | — |
| **Postman** | — | Postman CLI / `newman` (`pnpm docs:upload`) | optional: `mcp.postman.com` |
| **Cloudflare Turnstile** | fetch verify | `wrangler` | — (low value) |
| **Docker** | — | `docker` (`compose`, `buildx bake`) | optional: Docker MCP Toolkit |
| **Context7** (lib docs) | — | — | ✅ `@upstash/context7-mcp` |
| **codegraph** (code index) | — | `codegraph` | ✅ `codegraph serve --mcp` |

**Stripe is the canonical "all three" case:** the `stripe` SDK runs in the service, the
`stripe` CLI replays/triggers webhooks against the local `stripe-webhook` domain in dev/CI,
and the Stripe MCP lets an agent inspect test-mode objects. They coexist; none replaces another.

## What the agent already has

The MCP servers in [`.mcp.example.json`](../../.mcp.example.json) (mirrored at
`agent-os/mcp/mcp.example.json`): **context7, core-be:api, neon, sentry, github, slack,
railway, aws, stripe, codegraph**. These are *agent-only*; CI/CD and runtime do not use them.

## Recommended additions (agent MCP only — CI/CD keeps the CLIs)

Added to `.mcp.example.json`. None of these change CI/CD or runtime — Sonar/Semgrep still run
as CLI gates, the app still uses `ioredis`. The MCP server only gives the **interactive agent**
a structured way to read findings / inspect Redis instead of parsing CLI stdout over Bash.

```jsonc
"semgrep":   { "command": "uvx", "args": ["semgrep-mcp"] },
"sonarqube": { "command": "docker",
               "args": ["run", "--init", "--pull=always", "--rm", "-i",
                        "-e", "SONARQUBE_TOKEN", "-e", "SONARQUBE_URL", "mcp/sonarqube"] },
"redis":     { "command": "uvx",
               "args": ["--from", "redis-mcp-server@latest", "redis-mcp-server",
                        "--url", "${REDIS_URL}"] }
```

> Endpoints and package names move fast — verify against each vendor's current docs before
> relying on a config. Sources: [Semgrep MCP](https://github.com/semgrep/mcp),
> [SonarQube MCP](https://github.com/SonarSource/sonarqube-mcp-server),
> [Redis MCP](https://github.com/redis/mcp-redis).

## Umbrella option — Composio

Composio is a single MCP layer over 500+ apps. It is an **alternative** to wiring each
vendor's first-party MCP, useful for cross-app glue (e.g. post Sonar findings to Slack/Notion).
Trade-off: one auth/governance plane vs. the deeper first-party tools (Sentry Seer, Stripe test
fixtures). For this backend, keep the first-party MCP servers above and reach for Composio only
for cross-app workflows.
