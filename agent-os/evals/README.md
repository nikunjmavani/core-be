# agent-os evals

Treats the `agent-os/` bundle (skills, rules, agents, docs, hooks) as **tested code**, not just documentation. The bundle is a large, cross-referenced surface that drifts silently — stale counts, dead path references, index/disk divergence, non-portable hook commands. These evals turn that drift into a failing gate instead of a months-later human audit.

> **Why this exists:** a June 2026 audit found 7 of 37 skills had silently drifted (wrong counts, a dead `.github/sync.config.json` reference, a hook hardcoded to one developer's home path, `schema-generator` missing from the trigger map) with zero detection. This harness is the closed loop: **author → enforce → measure** instead of author → hope.

## Two tiers

| Tier | File | Question | CI |
| ---- | ---- | -------- | -- |
| **1 — integrity** | [`check.ts`](check.ts) | Is the bundle internally consistent? (deterministic, zero-token) | **Gates** — exits 1 on any error |
| **2 — triggers** | [`trigger-eval.ts`](trigger-eval.ts) | When file X changes, does the routing map surface the right skill(s)? | **Gates** — `agent-os:triggers:strict` in CI |

## Run

```bash
pnpm agent-os:check            # Tier 1 gate (CI)
pnpm agent-os:check:report     # Tier 1 verbose — every check + warnings
pnpm agent-os:triggers         # Tier 2 report (local)
pnpm agent-os:triggers:strict  # Tier 2 gate (CI) — exits 1 on a missing route
```

`pnpm agent-os:check` and `pnpm agent-os:triggers:strict` are wired into `ci:local` and `ci:quality`.

## Tier 1 checks (`check.ts`)

| Check | Catches |
| ----- | ------- |
| Skill frontmatter & names | missing `name`/`description`, `name` ≠ directory |
| Skill-index counts | "36 skills" when 37 exist |
| Skill-index ↔ disk | a skill on disk missing from the index table, an index row with no directory, an index path that doesn't resolve |
| Sync-rule count | "22 sync rules" when 24 `*-sync.mdc` exist |
| Agent catalog count & coverage | "All 8 agents" when 9 exist; an agent file absent from the catalog |
| Agent frontmatter | missing `name`/`description`; `model` pinned off `inherit` (warn) |
| Hook portability | `.claude/settings.json` hook hardcoding `/Users/…` instead of `$CLAUDE_PROJECT_DIR` |
| Referenced paths exist | a backticked `src/…` / `.github/…` path in any skill/rule/doc that doesn't exist |

Warnings (non-blocking): thin skill descriptions (< 80 chars, weak auto-trigger) and agents pinning a non-`inherit` model.

### `ignore.json`

The referenced-path check allowlists intentionally-uncommitted paths (gitignored env templates, generated specs). Add an entry **only** when a path is deliberately absent — a genuine dead reference should be fixed, not ignored.

## Tier 2 cases (`cases/triggers.json`)

Each case maps a changed file to the skills the routing map must surface:

```json
{ "file": "src/domains/x/y/y.schema.ts",
  "expectSkills": ["sql-design-guard", "db-migration-maintainer", "schema-generator"] }
```

`trigger-eval.ts` converts the globs in `skill-triggers.md` to matchers, resolves each file, and reports expected skills the map fails to surface. Add a case whenever you wire a new file-pattern → skill route.

## Roadmap

- ~~Promote Tier 2 to a gate~~ ✅ done — `agent-os:triggers:strict` gates CI alongside Tier 1.
- **Tier 3 — output quality (LLM-judge).** Feed a skill its triggering scenario, score the response against a rubric/gold answer (faithfulness, completeness), gate on a calibrated threshold. Pairs with [DeepEval](https://github.com/confident-ai/deepeval) + an OTel trace store.
- **Telemetry-fed curation.** With Claude Code OpenTelemetry export, fold real trigger-rate and cost data in — prune skills that never fire, harden the ones that do.

See [`agent-os/docs/skill-triggers.md`](../docs/skill-triggers.md) for the routing map under test.
