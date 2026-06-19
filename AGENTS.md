# Guidance for coding agents (core-be)

Before changing this repository:

1. Follow **[.cursor/rules/engineering-principles.mdc](.cursor/rules/engineering-principles.mdc)** for general engineering behavior (always applied in Cursor). Product slug, image names, and branch/env mapping: **[.cursor/rules/project-identity.mdc](.cursor/rules/project-identity.mdc)** (`tooling/setup/setup.config.json` → `project-identity.constants.ts`).
2. Read **[CLAUDE.md](CLAUDE.md)** for architecture, domain layout, dependency rules, and commands. Import path policy: **[`.cursor/rules/import-paths.mdc`](.cursor/rules/import-paths.mdc)** (`@/` in `src/`, `@tooling/` in tooling; no `../`).
3. For new domains, routes, workers, or schema work, follow **[docs/getting-started/requirement-intake.md](docs/getting-started/requirement-intake.md)** and consult **[skill-index](agent-os/skills/skill-index/SKILL.md)** first (39 project skills; Cursor built-ins: **cursor-global-skills**) — run only the skills that match your changes (no duplicate invocations).
4. For any change under `src/`, the **in-source documentation system** also applies — see **[docs/reference/architecture/documentation-system.md](docs/reference/architecture/documentation-system.md)**. TSDoc on every public export is canonical (gated by `pnpm tsdoc:check` against [`tooling/tsdoc-coverage/budget.json`](tooling/tsdoc-coverage/budget.json) — counts may decrease but may not increase); hand-written `OVERVIEW.md` files cover folder-level design decisions; `src/{OVERVIEW,PATTERNS,FLOWS,POLICIES}.md` carry the system narrative. There is no auto-generated `DOCS.md` aggregator.
5. Human contributors — see **[CONTRIBUTING.md](CONTRIBUTING.md)** (setup summary, branching, **`SECURITY.md`**, **`CODE_OF_CONDUCT.md`**, **[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)**).
6. Before opening a pull request, ensure these pass (pre-commit runs the same sync checks locally):

 ```bash
 pnpm guard:pre-commit   # labeled pre-commit (same as git commit hook)
 pnpm ci:local
 ```

   Same checks individually: `pnpm validate`, `pnpm validate:domain`, `pnpm routes:catalog:check`, `pnpm tsdoc:check`, `pnpm db:migrate:lint`, `pnpm tool:sync-env-example`, `pnpm test`. Static CI quality slice (no tests): `pnpm ci:quality`.

   Optional local integration gate (Docker Postgres + Redis running): `pnpm verify:base` — migrate → seed (minimal + full) → live API smoke → validate. Local stack: `pnpm compose:up` then `pnpm compose:wait`.

## Additional resources

- **Cursor cloud agent** — Linux environments with full dev dependencies (separate from production image): **[docs/integrations/cursor-cloud-agent-environment.md](docs/integrations/cursor-cloud-agent-environment.md)**
- **Claude Code on the web** — network access, setup script, env vars, Postgres/Redis: **[docs/integrations/claude-code-web-environment.md](docs/integrations/claude-code-web-environment.md)**
- **Codex Cloud setup archive** — reference-only notes for removed setup attempts: **[docs/integrations/codex-cloud-agent-setup-archive.md](docs/integrations/codex-cloud-agent-setup-archive.md)**
- **Agent map** — skills, rules, subagents, MCP: **[docs/integrations/cursor-agent-system.md](docs/integrations/cursor-agent-system.md)**

## Custom subagents

Project-defined subagents in [`agent-os/agents/`](agent-os/agents/) run in isolation
(read-only) for heavy diagnostics.

**Full catalog + use-when:** [agent-os/docs/agents-catalog.md](agent-os/docs/agents-catalog.md)
**Platform invocation (Cursor / Claude Code / Codex):** [agent-os/docs/platform-access.md](agent-os/docs/platform-access.md)
**Skill trigger map:** [agent-os/docs/skill-triggers.md](agent-os/docs/skill-triggers.md) — file pattern → which skill to invoke.

To add a subagent, use global **create-subagent**
(see [cursor-global-skills](agent-os/skills/cursor-global-skills/SKILL.md)).

## Custom commands

Reusable slash commands live in [`agent-os/commands/`](agent-os/commands/) (single
source of truth). Claude Code reads them via `.claude/commands`, Cursor via
`.cursor/commands`; for Codex, symlink them into `~/.codex/prompts/` (see
[agent-os/commands/README.md](agent-os/commands/README.md)). Available: `/validate`,
`/ci-local`, `/new-domain`, `/routes-sync`.

## Guardrails

Executable guardrails enforce the repo's safety rules per platform
(see [`agent-os/hooks/README.md`](agent-os/hooks/README.md)):

- **Claude Code** — `SessionStart` + `PreToolUse` hooks in [`agent-os/hooks/`](agent-os/hooks/)
  (wired in `.claude/settings.json`): verify env + install deps on the web; block
  destructive shell and secret writes; warn on protected paths and cross-domain imports.
- **Cursor** — `beforeShellExecution` hook (`.cursor/hooks.json`) blocks destructive
  shell; file-level rules are advisory in [`.cursor/rules/ai-guardrails.mdc`](.cursor/rules/ai-guardrails.mdc).
- **Codex** — enforce via generated project-local [`.codex/hooks.json`](.codex/hooks.json)
  (from `agent-os/hooks/hooks.json`: startup context, prompt skill routing, Bash
  guardrails, stop reminders), [`.codex/config.toml`](.codex/config.toml)
  (symlink to generated default MCP pair: CodeGraph + Headroom), sandbox +
  approvals in `~/.codex/config.toml` (`sandbox_mode = "workspace-write"`,
  `approval_policy = "on-request"`), plus the policy below.

Policy (all agents): never write secrets to source (`.env*` except `.env.example`);
no `rm -rf` / `git push --force`; treat `migrations/*.sql` and billing ledgers as
immutable (add-only); cross-domain access goes through services, not repositories/schemas.
