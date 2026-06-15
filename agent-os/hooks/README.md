# agent-os hooks

Claude Code hooks that enforce and accelerate the agent-os workflow. Wired in [`.claude/settings.json`](../../.claude/settings.json); the eval gate ([`agent-os/evals/check.ts`](../evals/check.ts)) verifies every referenced script exists and uses `$CLAUDE_PROJECT_DIR` (never a hardcoded path).

| Hook | Event | What it does |
| ---- | ----- | ------------ |
| [`guard-edits.sh`](guard-edits.sh) | PreToolUse (Edit/Write/MultiEdit) | **Blocks** edits that violate a hard rule *before* they land: worker/processor use of `getRequestDatabase`/`request-database.context`, `../` parent imports under `src/`, and hand-edits to generated files. Fails **open**. |
| [`session-start.sh`](session-start.sh) | SessionStart | Injects the routing map ([`skill-triggers.md`](../docs/skill-triggers.md)) as `additionalContext` so every session starts knowing which skill to run. |
| [`skill-reminder.sh`](skill-reminder.sh) | PostToolUse (Edit/Write) | After an edit, surfaces the skill(s) relevant to the changed file. |

## Design rules

- **Fail open.** A hook bug must never brick a session — a missing `jq`, malformed input, or any error *allows* the action. `guard-edits.sh` only ever **denies** on an unambiguous, high-confidence violation that is already a documented CLAUDE.md invariant enforced by a global test.
- **Portable.** Commands use `$CLAUDE_PROJECT_DIR`, never an absolute home path (enforced by `pnpm agent-os:check`).
- **Reminder vs block.** `skill-reminder.sh` nudges; `guard-edits.sh` enforces. Add a new hard block only when the rule is mechanically unambiguous.

## Test a hook locally

Pipe a synthetic tool payload to the script:

```bash
# → permissionDecision: deny
echo '{"tool_input":{"file_path":"src/x.worker.ts","content":"getRequestDatabase()"}}' \
  | bash agent-os/hooks/guard-edits.sh

# → no output (allowed)
echo '{"tool_input":{"file_path":"src/x.service.ts","new_string":"const x = 1"}}' \
  | bash agent-os/hooks/guard-edits.sh
```
