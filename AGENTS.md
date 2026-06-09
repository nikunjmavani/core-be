# Guidance for coding agents (core-be)

Before changing this repository:

1. Follow **[.cursor/rules/engineering-principles.mdc](.cursor/rules/engineering-principles.mdc)** for general engineering behavior (always applied in Cursor). Product slug, image names, and branch/env mapping: **[.cursor/rules/project-identity.mdc](.cursor/rules/project-identity.mdc)** (`tooling/setup/setup.config.json` → `project-identity.constants.ts`).
2. Read **[CLAUDE.md](CLAUDE.md)** for architecture, domain layout, dependency rules, and commands. Import path policy: **[`.cursor/rules/import-paths.mdc`](.cursor/rules/import-paths.mdc)** (`@/` in `src/`, `@tooling/` in tooling; no `../`).
3. For new domains, routes, workers, or schema work, follow **[docs/getting-started/requirement-intake.md](docs/getting-started/requirement-intake.md)** and consult **[skill-index](.cursor/skills/skill-index/SKILL.md)** first (36 project skills; Cursor built-ins: **cursor-global-skills**) — run only the skills that match your changes (no duplicate invocations).
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
- **Agent map** — skills, rules, subagents, MCP: **[docs/integrations/cursor-agent-system.md](docs/integrations/cursor-agent-system.md)**

## Custom subagents

Project-defined subagents in [`.cursor/agents/`](.cursor/agents/) run in isolation (read-only) for heavy diagnostics. Each agent file includes a **Platform access** table showing how to invoke it from Cursor, Claude Code, and Codex.

| Subagent | File | Use when |
| -------- | ---- | -------- |
| **production-reviewer** | [`.cursor/agents/production-reviewer.md`](.cursor/agents/production-reviewer.md) | Pre-release / deploy sign-off — full readiness plan |
| **verifier** | [`.cursor/agents/verifier.md`](.cursor/agents/verifier.md) | After claiming work complete — scoped validate/tests |
| **ci-investigator** | [`.cursor/agents/ci-investigator.md`](.cursor/agents/ci-investigator.md) | One failing CI check — root cause without log noise |
| **production-hardening-reviewer** | [`.cursor/agents/production-hardening-reviewer.md`](.cursor/agents/production-hardening-reviewer.md) | Hardening sweep — security headers, DB/Redis/worker gaps |
| **docs-auditor** | [`.cursor/agents/docs-auditor.md`](.cursor/agents/docs-auditor.md) | Full docs/ audit — stale links, index gaps, Mermaid issues |
| **sql-design-reviewer** | [`.cursor/agents/sql-design-reviewer.md`](.cursor/agents/sql-design-reviewer.md) | Schema design review — indexes, constraints, conventions |
| **dependency-auditor** | [`.cursor/agents/dependency-auditor.md`](.cursor/agents/dependency-auditor.md) | Dependency audit — vulnerabilities + prioritized fix plan |
| **tsdoc-coverage-reviewer** | [`.cursor/agents/tsdoc-coverage-reviewer.md`](.cursor/agents/tsdoc-coverage-reviewer.md) | TSDoc coverage check — missing summaries and @remarks |

To add a subagent, use global **create-subagent** (see [cursor-global-skills](.cursor/skills/cursor-global-skills/SKILL.md)).
