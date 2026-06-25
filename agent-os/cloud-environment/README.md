# agent-os/cloud-environment — shared cloud agent setup

Single source of truth for **cloud session** bring-up (Cursor Cloud Agents, Claude Code
on the web, and similar remote Linux VMs). Local human setup stays in
[docs/getting-started/setup.md](../../docs/getting-started/setup.md).

Implementation scripts live in [`tooling/setup/agent/`](../../tooling/setup/agent/)
(Node, Docker, bootstrap, healthcheck). This directory holds the **policy** agents and
operators copy into each platform's environment config.

## Layout

| File | Purpose |
| ---- | ------- |
| [`environment.json`](environment.json) | Cursor Cloud Agents — `install`, `start`, optional `terminals` |
| [`install.sh`](install.sh) | Idempotent cached install (tools + deps; **no** full stack bring-up) |
| [`agents-cloud.md`](agents-cloud.md) | On-demand stack instructions every agent reads via `AGENTS.md` |

## How each platform picks it up

| Platform | Config location | What to wire |
| -------- | --------------- | ------------ |
| **Cursor** | [`.cursor/environment.json`](../../.cursor/environment.json) → symlink here | `install` runs `install.sh`; optional `start` / `terminals` from `environment.json` |
| **Cursor dashboard** | Cloud Agents → Environment → Install script | Paste contents of `install.sh`, or `bash agent-os/cloud-environment/install.sh` |
| **Claude Code on the web** | Environment → Setup script field | Same `install.sh` lines (see [claude-code-web-environment.md](../../docs/integrations/claude-code-web-environment.md)) |
| **All agents** | [`AGENTS.md`](../../AGENTS.md) → [`agents-cloud.md`](agents-cloud.md) | On-demand `bootstrap.sh` when DB/API/workers are needed |

> **Do not** put full [`bootstrap.sh`](../../tooling/setup/agent/bootstrap.sh) in the
> cached `install` step until restricted-Docker fallbacks are reliable on every VM.
> A failed install exits non-zero and Cursor shows an environment warning for the
> whole session. Run bootstrap **on demand** (see `agents-cloud.md`) instead.

## Network allowlist (cloud)

Minimum Custom allowlist entry beyond defaults:

- `nodejs.org` — Node 24 install (`install-node.sh`)

For Docker image pulls without the GCR mirror script, also add
`production.cloudfront.docker.com`. Prefer
[`install-docker-images.sh`](../../tooling/setup/agent/install-docker-images.sh) in
`install.sh` (already included).

## MCP (default pair)

Configure in the platform MCP settings (and/or repo [`.mcp.json`](../../.mcp.json)):

| Server | Command | Notes |
| ------ | ------- | ----- |
| `codegraph` | `codegraph serve --mcp` | CLI from `install-codegraph.sh`; PATH must include `~/.local/bin` |
| `headroom` | `headroom mcp serve` | CLI from `install-headroom.sh` |

## Related

- [cursor-cloud-agent-environment.md](../../docs/integrations/cursor-cloud-agent-environment.md) — image + GitHub prerequisites
- [claude-code-web-environment.md](../../docs/integrations/claude-code-web-environment.md) — tiers, env vars, full bootstrap option
- [Cursor Cloud Agent setup](https://cursor.com/docs/cloud-agent/setup) — platform docs for `environment.json`
