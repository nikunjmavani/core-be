# Claude Code session setup

How Claude Code is set up for core-be. The setup is **one common configuration** —
the hooks, the `pnpm` gates, and the `agent-os/` skills/rules are committed to the
repo and apply to **every session the same way**. The same files drive every
session, so there is nothing surface-specific to maintain.

The Cursor and local Codex agent map is
[cursor-agent-system.md](cursor-agent-system.md). Codex Cloud setup notes were
archived separately because they apply only to managed cloud sessions, not local
Codex.

---

## What every session gets

- **Hooks** — wired in [`.claude/settings.json`](../../.claude/settings.json) and
  documented in [`agent-os/hooks/README.md`](../../agent-os/hooks/README.md):
  `SessionStart` (readiness + injects the skill-routing map), `UserPromptSubmit`
  (proactive skill routing), `PreToolUse` (guardrails + PR-creation escalation),
  `PostToolUse` (auto-format + skill reminders), `PostToolUseFailure` (gate-fix
  hints), and `Stop` (gate reminder). All **fail-open** — a hook bug never bricks a
  session.
- **Commit / push gates** — Husky activates after `pnpm install` (its `prepare`
  step), so every session runs the **same** pre-commit / pre-push gates
  ([`.husky/pre-commit`](../../.husky/pre-commit)), including the mandatory
  SonarQube gate.
- **Skills, rules, routing** — [`CLAUDE.md`](../../CLAUDE.md) plus the
  [skill-trigger map](../../agent-os/docs/skill-triggers.md), injected as context by
  the `SessionStart` hook.

Because these are committed to the repo, they behave identically in every session —
there is no separate per-surface configuration.

---

## Toolchain is handled for you

Install the toolchain once via [`SETUP.md`](../../SETUP.md) (Node, pnpm, gitleaks,
Docker, …). From then on, the
[`session-start.sh`](../../agent-os/hooks/session-start.sh) hook makes each session
self-sufficient: it **installs anything still missing and skips whatever is already
present** (`command -v gitleaks`, the dependencies check, …), and it is
**fail-open** — so a session is ready with no manual per-session setup.

---

## Related

- [`agent-os/hooks/README.md`](../../agent-os/hooks/README.md) — every hook, what it does, and how it is wired.
- [SETUP.md](../../SETUP.md) — one-time toolchain setup (runtimes, env vars, services).
- [CLAUDE.md](../../CLAUDE.md) — project agent guidelines and the skill index.
- [claude-code-web-environment.md](claude-code-web-environment.md) — hosted / cloud environment specifics (when a session runs on managed infrastructure rather than your machine).
