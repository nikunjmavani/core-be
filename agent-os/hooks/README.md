# agent-os hooks

Agent hooks that enforce and accelerate the agent-os workflow, shared across AI
tools. `agent-os/` is the single source of truth; `.claude/hooks` is a symlink to
this directory, and Cursor references these files from `.cursor/hooks.json`. The
eval gate ([`agent-os/evals/check.ts`](../evals/check.ts)) verifies every
referenced `.sh` script exists and that hook commands use `$CLAUDE_PROJECT_DIR`
(never a hardcoded path).

| Hook | Platform / event | What it does |
| ---- | ---------------- | ------------ |
| [`guard-edits.sh`](guard-edits.sh) | Claude `PreToolUse` (Edit/Write/MultiEdit) | **Blocks** edits that violate a hard rule before they land: worker/processor use of `getRequestDatabase`/`request-database.context`, `../` parent imports under `src/`, and hand-edits to generated files. Fails open. |
| [`guardrails.mjs`](guardrails.mjs) | Claude `PreToolUse` (Bash/Edit/Write) | **Blocks** destructive shell (`rm -rf`, `git push --force`, fork bomb, `mkfs`/`dd`) and secret writes (`.env*`, private-key/live-credential content); **warns** on protected-path edits (`migrations/*.sql`, billing ledgers) and cross-domain service imports. The shell scan strips quoted strings/heredocs so patterns in a message/echo don't false-trigger. Fails open. |
| [`session-start.sh`](session-start.sh) | Claude `SessionStart` | On the web, verifies Node/deps/codegraph and installs deps (switching to a new-enough Node via `$CLAUDE_ENV_FILE` when needed); injects the skill-trigger routing map + an env/commands summary as `additionalContext`. Runs synchronously. |
| [`skill-reminder.sh`](skill-reminder.sh) | Claude `PostToolUse` (Edit/Write) | After an edit, surfaces the skill(s) relevant to the changed file. |
| [`cursor-shell-guard.mjs`](cursor-shell-guard.mjs) | Cursor `beforeShellExecution` (beta) | Blocks the same destructive shell as `guardrails.mjs`. File-level rules are advisory in `.cursor/rules/ai-guardrails.mdc` (Cursor can't block file writes). |

## Wiring

- **Claude Code** — `.claude/settings.json`: `PreToolUse` runs **both** `guard-edits.sh`
  and `guardrails.mjs`; plus `SessionStart`, `PostToolUse`, `Stop`. Commands use
  `$CLAUDE_PROJECT_DIR/agent-os/hooks/…`.
- **Cursor** — `.cursor/hooks.json` → `beforeShellExecution`. Command paths resolve
  **relative to `.cursor/`**, so the entry uses `../agent-os/hooks/…`.
- **Codex** — no committable hook; enforce via `~/.codex/config.toml`
  (sandbox/approvals) + the policy in `AGENTS.md`.

## Design rules

- **Fail open.** A hook bug must never brick a session — a missing tool, malformed
  input, or any error *allows* the action. Hooks deny only on unambiguous,
  high-confidence violations.
- **Portable.** Commands use `$CLAUDE_PROJECT_DIR`, never an absolute home path
  (enforced by `pnpm agent-os:check`).
- **Reminder vs block.** `skill-reminder.sh` nudges; `guard-edits.sh` /
  `guardrails.mjs` enforce.

## Test a hook locally

```bash
# guard-edits.sh -> permissionDecision: deny
echo '{"tool_input":{"file_path":"src/x.worker.ts","content":"getRequestDatabase()"}}' | bash agent-os/hooks/guard-edits.sh

# guardrails.mjs -> deny / allow (empty) / warn
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' | node agent-os/hooks/guardrails.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}'    | node agent-os/hooks/guardrails.mjs

# SessionStart (simulate the web)
CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$PWD" bash agent-os/hooks/session-start.sh

# Cursor shell guard
echo '{"command":"git push --force"}' | node agent-os/hooks/cursor-shell-guard.mjs
```

## Notes

- The shell guards scan with quoted strings + heredoc bodies removed, so a
  destructive pattern that only appears in a message/echo (e.g. a commit message)
  doesn't false-trigger while real commands still block. Accident-prevention, not
  a hard boundary — a `bash -c "…"` wrapper can bypass it.
- Cursor agent hooks are **beta**.
