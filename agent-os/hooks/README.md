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
| [`no-unrequested-pr.sh`](no-unrequested-pr.sh) | Claude `PreToolUse` (`mcp__github__create_pull_request`) | Escalates every GitHub PR-creation attempt to an explicit user confirmation (`permissionDecision: "ask"`) — a deterministic backstop for the "open a PR only when explicitly asked" rule. Does **not** block; fails open. |
| [`session-start.sh`](session-start.sh) | Claude `SessionStart` | On the web, verifies Node/deps/codegraph, installs deps (switching to a new-enough Node via `$CLAUDE_ENV_FILE` when needed), and runs `pnpm agent-os:check` as the **only** startup gate (fail-open, web-only); self-heals **gitleaks** on web sessions whose cached image predates the Setup-script wiring, so the pre-commit secret scan can run (no-op when already present); injects the skill-trigger routing map + an env/commands summary — led by an **environment-provisioned** verdict (Node ≥ required + deps) plus `gh` presence — as `additionalContext`. Heavy work (`compose:up`, migrate, seed, tests, `pnpm dev`) runs on demand per prompt, not at startup. Runs synchronously. |
| [`prompt-skill-router.sh`](prompt-skill-router.sh) | Claude `UserPromptSubmit` | When a prompt describes a build/change task (a build verb + a domain noun), injects the matching skill chain + the "consult skill-index FIRST" rule + the requirement-intake link as `additionalContext` — the proactive, prompt-time complement to `skill-reminder.sh`. Conservative (silent on questions / read-only asks); fails open. |
| [`skill-reminder.sh`](skill-reminder.sh) | Claude `PostToolUse` (Edit/Write) | After an edit, surfaces the skill(s) relevant to the changed file. |
| [`format-edits.sh`](format-edits.sh) | Claude `PostToolUse` (Edit/Write) | Runs `biome format --write` on the edited file so formatting never reaches the `pnpm validate` gate dirty. Scope matches `pnpm format` (`src/**`, `tooling/**`) and Biome-supported file types only; format-only (no lint autofix/import reorder). Fails open (no-op when deps/biome absent). |
| [`gate-failure-hint.sh`](gate-failure-hint.sh) | Claude `PostToolUseFailure` (Bash) | When a known sync/validation gate fails (`validate:domain`, `routes:catalog`, `tsdoc:check`, `agent-os:check`, `db:migrate:lint`, env/route gates, lint/typecheck), injects the fix command + owning skill as `additionalContext`. Silent for ordinary command failures. Fails open. |
| [`stop-gate-reminder.sh`](stop-gate-reminder.sh) | Claude `Stop` | At end of turn, maps the uncommitted working-tree changes to the specific gate(s) they imply (routes → catalog, schema → migration lint + RLS, env → sync, i18n, workers, …) and prints a targeted checklist; falls back to a generic quick-checks reminder when nothing relevant changed. Plain stdout, non-blocking; fails open. |
| [`cursor-shell-guard.mjs`](cursor-shell-guard.mjs) | Cursor `beforeShellExecution` (beta) | Blocks the same destructive shell as `guardrails.mjs`. File-level rules are advisory in `.cursor/rules/ai-guardrails.mdc` (Cursor can't block file writes). |

## Wiring

- **Claude Code** — `.claude/settings.json`: `SessionStart` runs `session-start.sh`;
  `UserPromptSubmit` runs `prompt-skill-router.sh`; `PreToolUse` runs
  `guard-edits.sh`, `guardrails.mjs`, and `no-unrequested-pr.sh` (PR-creation
  guard); `PostToolUse` (Edit/Write) runs `format-edits.sh` **and**
  `skill-reminder.sh`; `PostToolUseFailure` (Bash) runs `gate-failure-hint.sh`;
  `Stop` runs `stop-gate-reminder.sh`. Commands use `$CLAUDE_PROJECT_DIR/agent-os/hooks/…`.
  These hooks are committed to the repo, so they run in **both local and web**
  sessions (web-only work like tool installs is gated on `CLAUDE_CODE_REMOTE`). (The
  formatter, the gate hint, the PR guard, the prompt router, and the stop reminder
  are Claude-only — Cursor mirrors only the shell guard.)
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
- **Reminder vs fix vs escalate vs block.** `skill-reminder.sh` /
  `gate-failure-hint.sh` / `prompt-skill-router.sh` / `stop-gate-reminder.sh` nudge
  (context only, never block); `format-edits.sh` silently fixes formatting
  (mutating but safe, in-scope only); `no-unrequested-pr.sh` escalates PR creation
  to user confirmation (`ask`); `guard-edits.sh` / `guardrails.mjs` enforce (`deny`).

## Test a hook locally

```bash
# guard-edits.sh -> permissionDecision: deny
echo '{"tool_input":{"file_path":"src/x.worker.ts","content":"getRequestDatabase()"}}' | bash agent-os/hooks/guard-edits.sh

# guardrails.mjs -> deny / allow (empty) / warn
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' | node agent-os/hooks/guardrails.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}'    | node agent-os/hooks/guardrails.mjs

# SessionStart (simulate the web)
CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$PWD" bash agent-os/hooks/session-start.sh

# prompt-skill-router.sh -> additionalContext on a build prompt; silent on a question
echo '{"prompt":"add a new route and schema table for plans"}' | bash agent-os/hooks/prompt-skill-router.sh
echo '{"prompt":"what does the auth middleware do?"}'          | bash agent-os/hooks/prompt-skill-router.sh   # silent

# stop-gate-reminder.sh -> targeted gate checklist from `git status`; generic when clean
CLAUDE_PROJECT_DIR="$PWD" bash agent-os/hooks/stop-gate-reminder.sh

# format-edits.sh -> formats the edited file in place (no-op when biome/deps absent)
echo "{\"tool_input\":{\"file_path\":\"$PWD/src/server.ts\"}}" | bash agent-os/hooks/format-edits.sh

# gate-failure-hint.sh -> additionalContext when a known gate fails; silent otherwise
echo '{"tool_input":{"command":"pnpm validate:domain:strict"}}' | bash agent-os/hooks/gate-failure-hint.sh
echo '{"tool_input":{"command":"ls nope"}}'                    | bash agent-os/hooks/gate-failure-hint.sh   # silent

# no-unrequested-pr.sh -> permissionDecision: ask
echo '{"tool_input":{"title":"Add feature"}}' | bash agent-os/hooks/no-unrequested-pr.sh

# Cursor shell guard
echo '{"command":"git push --force"}' | node agent-os/hooks/cursor-shell-guard.mjs
```

## Notes

- The shell guards scan with quoted strings + heredoc bodies removed, so a
  destructive pattern that only appears in a message/echo (e.g. a commit message)
  doesn't false-trigger while real commands still block. Accident-prevention, not
  a hard boundary — a `bash -c "…"` wrapper can bypass it.
- Cursor agent hooks are **beta**.
