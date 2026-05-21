# Guidance for coding agents (core-be)

Before changing this repository:

1. Follow **[.cursor/rules/engineering-principles.mdc](.cursor/rules/engineering-principles.mdc)** for general engineering behavior (always applied in Cursor).
2. Read **[CLAUDE.md](CLAUDE.md)** for architecture, domain layout, dependency rules, and commands.
3. For new domains, routes, workers, or schema work, follow **[docs/getting-started/requirement-intake.md](docs/getting-started/requirement-intake.md)** and consult **[skill-index](.cursor/skills/skill-index/SKILL.md)** first (32 project skills; Cursor built-ins: **cursor-global-skills**) — run only the skills that match your changes (no duplicate invocations).
4. Human contributors — see **[CONTRIBUTING.md](CONTRIBUTING.md)** (setup summary, branching, **`SECURITY.md`**, **`CODE_OF_CONDUCT.md`**, **[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)**).
5. Before opening a pull request, ensure these pass (pre-commit runs the same sync checks locally):

   ```bash
   pnpm ci:local
   ```

   Same checks individually: `pnpm validate`, `pnpm validate:domain`, `pnpm routes:catalog:check`, `pnpm db:migrate:lint`, `pnpm tool:sync-env-example`, `pnpm test`. Static CI quality slice (no tests): `pnpm ci:quality`.

   Optional local integration gate (Docker Postgres + Redis running): `pnpm verify:base` — migrate → seed (minimal + full) → live API smoke → validate. Local stack: `pnpm compose:up` then `pnpm compose:wait`.

6. For **Cursor cloud agent** Linux environments (full dev dependencies, separate from production image), see **[docs/integrations/cursor-cloud-agent-environment.md](docs/integrations/cursor-cloud-agent-environment.md)**.
