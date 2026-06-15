# agent-os/commands — cross-platform custom commands

Reusable, project-scoped slash commands shared by all three AI tools. This
directory is the **single source of truth**; each tool reads it through a symlink
or a one-time setup step (the same pattern as `agent-os/agents` and
`agent-os/skills`).

## How each tool picks them up

| Tool | Path | Wiring | Invoke |
| ---- | ---- | ------ | ------ |
| **Claude Code** | `.claude/commands/` | symlink → `../agent-os/commands` (committed) | `/validate`, `/new-domain ...` |
| **Cursor** | `.cursor/commands/` | symlink → `../agent-os/commands` (committed) | type `/` in chat (Cursor ≥ 1.6) |
| **Codex** | `~/.codex/prompts/` | user-global — see setup below | `/<name>` in the TUI |

> Cursor ignores the YAML frontmatter and uses the markdown body as the prompt;
> Claude Code and Codex read `description` / `argument-hint` and expand
> `$ARGUMENTS`.

### Codex setup (one-time, per machine)

Codex loads prompts from `~/.codex/prompts/*.md` (user-global, not committable),
and OpenAI now marks custom prompts **deprecated** in favor of skills. To use
these with Codex in the meantime, symlink each file into your prompts dir:

```bash
mkdir -p ~/.codex/prompts
for f in "$PWD"/agent-os/commands/*.md; do ln -sf "$f" ~/.codex/prompts/; done
```

## Commands

| Command | Purpose |
| ------- | ------- |
| `/validate` | Run `pnpm validate` (lint + format + typecheck); fix introduced issues. |
| `/ci-local` | Run the full `pnpm ci:local` PR gate; summarize and fix failures. |
| `/new-domain <name>` | Scaffold a domain/sub-domain via the domain-generator skill. |
| `/routes-sync` | Re-sync route catalog + OpenAPI/seed artifacts after route changes. |

## Deferred (recorded for a follow-up)

Scoped out for now (this pass adds custom commands only):

- **SessionStart hook** — Claude Code `hooks.SessionStart` to *verify env (Node /
  deps / codegraph freshness) and print the skill-trigger map*. Cursor has no
  session-start event (closest: an `alwaysApply` rule); Codex's hook is
  experimental.
- **Guardrails** — *protected paths* (warn on `migrations/` + billing ledgers),
  *destructive shell* (block `rm -rf`, `git push --force`), *secrets* (block
  `.env` / key patterns), *cross-domain imports* (warn). Claude: committed
  PreToolUse hook; Cursor: `beforeShellExecution` hook; Codex: sandbox/approval +
  `AGENTS.md`.
