# Cursor agent system (core-be)

Map of skills, rules, subagents, and MCP tooling for coding agents and contributors using Cursor (or Claude Code with the same `.cursor/` layout).

---

## Entry points

| Doc | Role |
| --- | --- |
| [AGENTS.md](../../AGENTS.md) | Onboarding checklist, CI gates, custom subagents |
| [CLAUDE.md](../../CLAUDE.md) | Architecture, domains, commands |
| [requirement-intake.md](../getting-started/requirement-intake.md) | New feature/API intake + Plan workflow |
| [skill-index](../../ai/skills/skill-index/SKILL.md) | **Canonical** skill catalog, triggers, and auto-invoke rules |

```mermaid
flowchart LR
  User[Requirement or edit] --> Intake[requirement-intake]
  Intake --> Index[skill-index]
  Index --> Skills[Project skills]
  Index --> Rules[.cursor/rules]
  Rules --> Skills
  Skills --> Gates[pre-commit / CI]
```

---

## Project skills (36)

**36 total** — consult [skill-index](../../ai/skills/skill-index/SKILL.md) first. Includes **skill-index** (meta) and **cursor-global-skills** (reference to Cursor built-ins).

Common chains:

| Change | Skills (order) |
| --- | --- |
| New route | route-schema-doc-guard → openapi-multilingual (tags) → route-catalog → seed-maintainer → test-generator |
| New domain | domain-generator → schema-generator → sql-design-guard → db-migration-maintainer → … |
| Env var | env-schema-add |
| Hand-written doc under `docs/` | docs-maintainer |

**openapi-route-sync** is legacy (tag locales only). Use **route-schema-doc-guard** for route `schema` blocks.

---

## Cursor rules (37)

Two **always-on** rules: [engineering-principles.mdc](../../ai/rules/engineering-principles.mdc), [project-identity.mdc](../../ai/rules/project-identity.mdc).

All others are **glob-scoped** — they auto-attach when matching files are edited. Full table: [skill-index → Auto-trigger rules](../../ai/skills/skill-index/SKILL.md#auto-trigger-rules).

Policy rules (architecture, import paths, naming, object params) attach on `src/**/*.ts` without invoking a skill — they hold non-negotiable detail.

---

## Custom subagents

Defined in [`ai/agents/`](../../ai/agents/). All agents are **read-only**.
Cursor reads them via `.cursor/agents` → `ai/agents/` symlink.

| Reference | Link |
| --------- | ---- |
| Full catalog + use-when | [ai/docs/agents-catalog.md](../../ai/docs/agents-catalog.md) |
| Platform invocation table | [ai/docs/platform-access.md](../../ai/docs/platform-access.md) |

| Tool | How agents are invoked |
| ---- | ---------------------- |
| **Cursor** | `@<agent-name>` in Agent mode; auto-invokes from `description` frontmatter |
| **Claude Code** | `"Read ai/agents/<name>.md and follow the procedure"` |
| **Codex** | Reads `AGENTS.md` custom subagents table; invoke by name |

Add new agents with global **create-subagent**. See [cursor-global-skills](../../ai/skills/cursor-global-skills/SKILL.md).

---

## Global Cursor skills

Ship with Cursor under `~/.cursor/skills-cursor/`. **Not required** for normal backend work. Use when editing `ai/skills`, `ai/rules`, `ai/agents`, hooks, or IDE automation.

See [cursor-global-skills](../../ai/skills/cursor-global-skills/SKILL.md).

---

## MCP servers

Template: [`ai/mcp/mcp.example.json`](../../ai/mcp/mcp.example.json) → copy to `ai/mcp/mcp.json` (gitignored).
Symlinked: `.cursor/mcp.json` → `ai/mcp/mcp.json` (Cursor), `.mcp.json` → `ai/mcp/mcp.json` (Claude Code).
Configure once — all platforms read the same file.

| Server | Purpose |
| --- | --- |
| **codegraph** | Local semantic index — see [codegraph.md](codegraph.md) |
| **context7** | Version-specific backend library docs |
| **core-be:api** | Local Fastify MCP at `/api/v1/mcp` |
| **neon**, **sentry**, **github**, **slack**, **railway**, **aws**, **stripe** | Optional hosted integrations |

CodeGraph is provisioned in `pnpm setup:local` (phase 7/9).

---

## Cloud agent environment

Linux agent image with full devDependencies: [cursor-cloud-agent-environment.md](cursor-cloud-agent-environment.md) (`Dockerfile.agent`).

---

## Related

- [documentation-system.md](../reference/architecture/documentation-system.md) — in-source TSDoc, OVERVIEW.md, route schema
- [pr-review.md](../process/pr-review.md) — human and agent PR rubric
