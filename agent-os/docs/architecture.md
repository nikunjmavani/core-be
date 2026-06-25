# agent-os architecture — single source, generated adapters, drift-checked

`agent-os/` is the one source of truth for AI-coding-agent tooling, consumed by **Claude Code, Cursor, and Codex**. This doc explains how the pieces fit so the single-source promise is mechanical, not aspirational.

## The backbone

```text
common (authored once)            registry              generated / referenced adapters
─────────────────────             ────────              ───────────────────────────────
agent-os/skills/     SKILL.md  ┐
agent-os/agents/     *.md      │   agent-os/platforms/   .claude/ (settings.json, symlinks)
agent-os/rules/      *.mdc     ├──▶  targets.json    ──▶ .cursor/ (hooks.json, symlinks)
agent-os/hooks/      hooks.json│   (one row per agent)   AGENTS.md / Codex
agent-os/commands/   *.md      │
agent-os/mcp/        *.json    ┘   tooling/agent-os/generate.ts  (--check = drift gate)
agent-os/cloud-environment/  install.sh, environment.json, agents-cloud.md  ──▶ .cursor/environment.json (symlink)
```

- **Common** dirs are authored once, in open formats (`SKILL.md`, `*.md`, `*.mdc`, JSON). Their locations never move — every tool reads them where they are today.
- **The registry** — [`agent-os/platforms/targets.json`](../platforms/targets.json) — declares one row per agent: entrypoints, which common dirs it consumes, and capability flags (`skills`, `subagents`, `plugins`, `hookEvents`, `mcpFormat`, `agentsMd` traits).
- **The generator** — [`tooling/agent-os/generate.ts`](../../tooling/agent-os/generate.ts) — derives each agent's native wiring from common. `--check` (wired into `ci:local` + `ci:quality`) fails on drift; `--write` regenerates and is idempotent (it never rewrites an unchanged file). It reproduces today's `.claude/settings.json` + `.cursor/hooks.json` exactly, so adoption changed nothing.

## Hook wiring

[`agent-os/hooks/hooks.json`](../hooks/hooks.json) is the single manifest: each entry names a `script`, a `runtime`, and which agent event it targets (`claude` and/or `cursor`). The generator emits the Claude `settings.json` hooks block and the Cursor `hooks.json` block from it, skipping events an agent does not support. Scripts are fail-open (`$CLAUDE_PROJECT_DIR`, exit 0 on error).

## Orchestration

- **Groups** — [`agent-os/skills/groups.json`](../skills/groups.json): every skill in exactly one functional group.
- **Chains** — [`agent-os/skills/chains.json`](../skills/chains.json): ordered, named pipelines (`route-change`, `schema-change`, `worker-change`, `new-domain`) with a file-glob `trigger`. The single source for workflow commands and routing reminders.
- **Pipelines** — [`agent-os/agents/pipelines.json`](../agents/pipelines.json): read-only agent sequences (`pre-merge-review`, `prod-readiness`) with diagnostic→procedural handoff (each finding names the skill that fixes it).
- **Planner** — `pnpm agent-os:plan-skills <files|--diff>` matches a changeset against the chain triggers and prints the exact ordered skill series to run.

## Commands

[`agent-os/commands/`](../commands/) holds **workflow** commands (multi-step, orchestrating existing skills/agents/gates); granular procedures stay as skills. Build chains, the PR lifecycle (`/open-pr`→`/watch-pr`→`/merge-pr`, `/ship`), `/pre-merge-review`, `/agent-os-sync`, and `/build-requirement`. Command names are eval-checked for collisions.

## Requirement → production-ready build

Fill the full-slice template in [`docs/getting-started/requirement-intake.md`](../../docs/getting-started/requirement-intake.md) and run `/build-requirement`: it validates the spec, drives `schema-complete → domain-generator → route-complete → workers → seed → tests → docs → /pre-merge-review` through a self-healing verify loop, and emits a reports bundle under `docs/builds/<feature>/`.

## Continuous context

`pre-compact-preserve.sh` (PreCompact) emits a resume card before compaction; `session-end.sh` (SessionEnd) flags uncommitted work. Together with `codegraph + headroom` (the default MCP pair, declared per agent in `targets.json`) and subagent fan-out, a long unattended build keeps its thread.

## Onboarding a new (or upgraded) agent

Add `agent-os/platforms/<agent>/` plus one row in `targets.json`; the agent inherits all skills/rules/hooks/docs, the generator emits its native wiring, and the evals drift-check it. An existing agent gaining a capability is one flag flip + regenerate. The common dirs never churn.

## Guardrails

Everything above is enforced by [`agent-os/evals/check.ts`](../evals/check.ts) (counts, read-only agents, manifests, groups/chains/pipelines, command uniqueness, referenced paths) and `agent-os:generate:check` (adapter drift) — both run in CI and the pre-commit guard.
