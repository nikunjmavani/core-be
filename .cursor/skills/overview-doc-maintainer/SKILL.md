---
name: overview-doc-maintainer
description: Authors and maintains per-folder OVERVIEW.md files following one of four templates (A.1 domain, A.2 sub-domain, A.3 infrastructure/shared module, A.4 test suite). Use when adding a new domain, sub-domain, infrastructure module, or test suite folder, or when the validator reports a MISSING_OVERVIEW_SECTION token.
---

# Overview doc maintainer

Owns the hand-authored **`OVERVIEW.md`** at every documentable folder under `src/`. Each folder uses one of four templates depending on its role; the validator picks the right template from the folder path.

| Template | Variant id | When |
| --- | --- | --- |
| A.1 — Domain | `A.1-domain` | `src/domains/<domain>/OVERVIEW.md` |
| A.2 — Sub-domain (incl. nested) | `A.2-sub-domain` | `src/domains/<domain>/sub-domains/<sub>/OVERVIEW.md` and any nested children |
| A.3 — Infrastructure or shared module | `A.3-infra-shared` | `src/infrastructure/<module>/OVERVIEW.md`, `src/shared/<module>/OVERVIEW.md` |
| A.4 — Test suite | `A.4-test-suite` | `src/tests/<suite>/OVERVIEW.md` |

## When to run

Run this skill when:

- A new folder appears under `src/domains/`, `src/infrastructure/`, `src/shared/`, or `src/tests/<suite>/` and needs an `OVERVIEW.md`.
- The strict feature-doc check reports `MISSING_OVERVIEW_SECTION` in any `DOCS.md`.
- A domain's invariants change (new RLS contract, new lifecycle state, new cross-domain consumer) and the existing `OVERVIEW.md` is now stale.

## File header

Every `OVERVIEW.md` starts with the **bare backticked relative path** as line 1, no markdown link:

```markdown
`src/domains/billing/sub-domains/subscription/`

# Subscription
...
```

The validator at [`tooling/feature-docs/overview-reader.ts`](../../../tooling/feature-docs/overview-reader.ts) extracts this line and reports a missing-or-malformed first line as a soft warning today (will become a hard fail when the renderer enforces it).

## Templates

### A.1 — Domain (`src/domains/<domain>/OVERVIEW.md`)

Required H2 sections (validated):

- `## Purpose`
- `## Key invariants`
- `## Sub-domains`
- `## Patterns used`
- `## Cross-domain flows`

Recommended additional H2 sections:

- `## Lifecycle` (Mermaid `stateDiagram-v2` showing the domain aggregate's state transitions)
- `## Events` (emits / consumes; cross-link to event handler files)
- `## External integrations`
- `## Failure modes`
- `## Policy constants` (cross-link to `src/POLICIES.md`)
- `## Related runbooks`

Cross-links: every entry under `## Patterns used` should link to a section in `src/PATTERNS.md`. Every entry under `## Cross-domain flows` should link to a section in `src/FLOWS.md`. Use markdown links, not anchor text only.

### A.2 — Sub-domain (`src/domains/<domain>/sub-domains/<sub>/OVERVIEW.md` and nested children)

Required H2 sections (validated):

- `## Purpose`
- `## Key invariants`
- `## Lifecycle` (Mermaid `stateDiagram-v2`)

Add a `Parent:` line directly under the H1 to make the parent traversable. The relative path from a sub-domain's `OVERVIEW.md` to its parent domain's `OVERVIEW.md` is `../../OVERVIEW.md` (e.g. `src/domains/billing/sub-domains/subscription/OVERVIEW.md` → `src/domains/billing/OVERVIEW.md`). For nested sub-domains, the parent link should be the immediate parent sub-domain at `../OVERVIEW.md`. Format the line as a regular markdown link: `Parent:` followed by `[<domain-display-name>]` followed by `(<relative-path>)` — for a top-level sub-domain, the relative path is `../../OVERVIEW.md`; for a nested sub-domain, `../OVERVIEW.md`.

Recommended additional H2 sections:

- `## Events`
- `## External integrations`
- `## Failure modes`
- `## Policy constants`

### A.3 — Infrastructure or shared module (`src/infrastructure/<module>/OVERVIEW.md`)

Required H2 sections (validated):

- `## Purpose`
- `## Design decisions`

Recommended additional H2 sections:

- `## Operational concerns` (timeouts, pool sizing, eviction, runbook links)
- `## External dependencies`
- `## Tuning parameters`
- `## Failure modes`

`## Design decisions` is the heart of the file: it documents *why* the chosen library / pattern / interface was picked over plausible alternatives. If you can't articulate at least two design decisions, the module is probably too small for its own folder.

### A.4 — Test suite (`src/tests/<suite>/OVERVIEW.md`)

Required H2 section (validated):

- `## Purpose`

Recommended additional H2 sections:

- `## Test types`
- `## How to run` (exact `pnpm test:<suite>` command)
- `## Fixtures and helpers`
- `## Dependencies` (Postgres? Redis? Toxiproxy? k6?)
- `## Failure modes`

## How to add a new `OVERVIEW.md`

1. Determine the folder's role and pick the matching template.
2. Read the source files in the folder to understand purpose, invariants, lifecycle.
3. Cross-reference relevant entries in `src/PATTERNS.md` and `src/FLOWS.md`.
4. Author the file with the required H2 sections plus relevant recommended sections.
5. Run `pnpm features:generate` and confirm the matching `DOCS.md` Overview section quotes the first paragraph of `## Purpose` correctly.
6. Run `pnpm features:check:strict` and confirm no `MISSING_OVERVIEW_SECTION` regression.

## Anti-patterns

- ❌ Mentioning an invariant in `## Key invariants` without enforcing it somewhere (RLS policy, validator, test). Every invariant should be traceable to code.
- ❌ Drawing a Mermaid diagram with actor names that don't match the implementation classes. Use the actual class / function names.
- ❌ Putting a runbook link to a doc that doesn't exist yet. Either create the doc (via **docs-maintainer**) or omit the link.
- ❌ Authoring `OVERVIEW.md` for a `factories/` or `helpers/` directory — those are skipped by the validator. The folder must contain real source files.

## Cross-skill triggers

- After authoring → always invoke **feature-doc-maintainer** to refresh the index.
- Mentioning a pattern not in `src/PATTERNS.md` → invoke **system-narrative-maintainer** to add the pattern entry.
- Mentioning a flow not in `src/FLOWS.md` → invoke **system-narrative-maintainer** to add the flow entry.

## Related references

- Variant detection: [`tooling/feature-docs/folder-discovery.ts`](../../../tooling/feature-docs/folder-discovery.ts) (`pickOverviewVariant`)
- Required-section list per variant: [`tooling/feature-docs/overview-reader.ts`](../../../tooling/feature-docs/overview-reader.ts) (`REQUIRED_SECTIONS_BY_VARIANT`)
- Worked examples already in the repo: every `OVERVIEW.md` under `src/`.
