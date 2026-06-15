# agent-os/hooks — agent hook scripts

Hook scripts shared across AI tools. `agent-os/` is the single source of truth;
`.claude/hooks` is a symlink to this directory, and Cursor references these files
from `.cursor/hooks.json`.

| Script | Platform / event | What it does |
| ------ | ---------------- | ------------ |
| `session-start.sh` | Claude Code `SessionStart` | On the web, verifies Node/deps/codegraph; if Node is too old, switches to a new-enough Node when one is available (pinned for the session via `$CLAUDE_ENV_FILE`); installs deps (`pnpm install`) when Node is adequate; prints an env check + the skill-trigger map as session context. Runs **synchronously**. |
| `guardrails.mjs` | Claude Code `PreToolUse` (`Bash\|Edit\|Write`) | **Blocks** destructive shell (`rm -rf`, `git push --force`, fork bomb, `mkfs`/`dd`) and secret writes (`.env*` files, private-key/live-credential content). **Warns** on protected-path edits (`migrations/*.sql`, billing ledgers) and cross-domain imports in a service. Fail-open. |
| `cursor-shell-guard.mjs` | Cursor `beforeShellExecution` (beta) | Blocks the same destructive shell commands as `guardrails.mjs`. Cursor cannot block file writes, so secret/protected-path/cross-domain rules are advisory in `.cursor/rules/ai-guardrails.mdc`. |
| `skill-reminder.sh` | Claude Code `PostToolUse` (`Edit\|Write`) | Reminds which skill to run for the file just touched. |

## Wiring

- **Claude Code** — `.claude/settings.json` → `hooks.SessionStart`, `hooks.PreToolUse`,
  `hooks.PostToolUse` (commands invoked via `$CLAUDE_PROJECT_DIR/agent-os/hooks/...`).
- **Cursor** — `.cursor/hooks.json` → `beforeShellExecution`.
- **Codex** — has no committable hook; enforce via `~/.codex/config.toml`
  (`sandbox_mode`, `approval_policy`) plus the policy in `AGENTS.md`.

## Test locally

```bash
# SessionStart (simulate the web)
CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$PWD" bash agent-os/hooks/session-start.sh

# Guardrail — should DENY
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' | node agent-os/hooks/guardrails.mjs
echo '{"tool_name":"Write","tool_input":{"file_path":".env.production","content":"X=1"}}' | node agent-os/hooks/guardrails.mjs
# Guardrail — should ALLOW (no output) / WARN (systemMessage)
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}' | node agent-os/hooks/guardrails.mjs
echo '{"tool_name":"Edit","tool_input":{"file_path":"migrations/0001_init.sql","new_string":"select 1"}}' | node agent-os/hooks/guardrails.mjs

# Cursor shell guard
echo '{"command":"git push --force"}' | node agent-os/hooks/cursor-shell-guard.mjs
```

## Notes

- The shell guards scan the command **with quoted strings and heredoc bodies
  removed**, so a destructive pattern that only appears in a message/echo (e.g. a
  commit message) is not blocked, while real `rm -rf` / `git push --force`
  commands are. This is accident-prevention, not a hard security boundary — a
  command wrapped in `bash -c "…"` can still bypass it.
- All guards **fail-open**: a parse or runtime error allows the action so a hook
  bug can never brick the agent.
