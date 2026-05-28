---
name: feature-doc-maintainer
description: Regenerates per-folder DOCS.md across src/ and runs the strict baseline ratchet. Use after any code change that adds, removes, or renames a TypeScript export under src/, or whenever per-folder DOCS.md needs refreshing.
---

# Feature doc maintainer

Owns the **auto-generated** layer of the layered documentation system: every `src/**/DOCS.md` and the top-level `src/DOCS.md` index. Run this skill every time a TypeScript file under `src/` is added, removed, or renamed, or when an exported symbol is added, removed, or renamed.

## When to run

Run this skill **every time** you:

- Add, remove, or rename a `*.ts` file under `src/`.
- Add, remove, or rename an `export <kind> <name>` declaration anywhere under `src/`.
- Add, change, or remove a Fastify `schema` block on a route registration.
- Author or edit any `OVERVIEW.md` or one of the four system narratives (`src/OVERVIEW.md`, `src/PATTERNS.md`, `src/FLOWS.md`, `src/POLICIES.md`).
- See a `MISSING_DESCRIPTION`, `MISSING_REMARKS`, `MISSING_OVERVIEW_SECTION`, or `MISSING_SYSTEM_FILE` token in any `DOCS.md`.

This skill **does not** author content. It regenerates the index. Authoring is owned by sibling skills:

- TSDoc summary / `@remarks` on exports → **tsdoc-export-guard**
- `OVERVIEW.md` per folder → **overview-doc-maintainer**
- The four `src/*.md` narratives → **system-narrative-maintainer**
- Fastify route `schema` → **route-schema-doc-guard**

## How it works

### Step 1 — Regenerate

```bash
pnpm features:generate
```

This walks `src/`, builds the per-folder shape (`DocumentedFolder`), reads every `OVERVIEW.md`, every public TSDoc, every Fastify route schema, and writes the resulting `DOCS.md` files. It also writes `src/DOCS.md` as the catalog index.

### Step 2 — Strict ratchet check

```bash
pnpm features:check:strict
```

This is what the pre-commit hook and CI run. It fails when:

- Committed `DOCS.md` files differ from what the generator just produced (drift).
- Any of the four missing-token counts (`MISSING_DESCRIPTION`, `MISSING_REMARKS`, `MISSING_OVERVIEW_SECTION`, `MISSING_SYSTEM_FILE`) exceeds the **locked baseline** at [`tooling/feature-docs/missing-tokens.baseline.json`](../../../tooling/feature-docs/missing-tokens.baseline.json).

### Step 3 — Resolve any failure

If the strict check fails:

1. **Drift** → run `pnpm features:generate` and `git add` the changed `DOCS.md` files.
2. **`MISSING_DESCRIPTION` regression** → an export was added without a TSDoc summary. Invoke **tsdoc-export-guard**.
3. **`MISSING_REMARKS` regression** → a service / worker / processor / policy export was added without a TSDoc `@remarks` block. Invoke **tsdoc-export-guard**.
4. **`MISSING_OVERVIEW_SECTION` regression** → a folder's `OVERVIEW.md` is missing a required H2. Invoke **overview-doc-maintainer**.
5. **`MISSING_SYSTEM_FILE` regression** → one of `src/OVERVIEW.md`, `src/PATTERNS.md`, `src/FLOWS.md`, `src/POLICIES.md` is missing or has empty Purpose. Invoke **system-narrative-maintainer**.

### Step 4 — Refreshing the baseline (only after a deliberate reduction)

When you've reduced the missing-token count (e.g. by adding TSDoc to a batch of exports), re-lock the new (lower) baseline:

```bash
pnpm features:refresh-baseline
git add tooling/feature-docs/missing-tokens.baseline.json
```

The baseline is a **monotonic ratchet**: counts can only go down. PRs that increase any count are rejected by `features:check:strict`.

## Cross-skill triggers

When the generator surfaces missing content, this skill is the **dispatcher**, not the author. Cross-ping the right sibling skill:

| Failure                                | Sibling skill                  |
| -------------------------------------- | ------------------------------ |
| `MISSING_DESCRIPTION` on an export     | **tsdoc-export-guard**         |
| `MISSING_REMARKS` on a service-like export | **tsdoc-export-guard**     |
| `MISSING_OVERVIEW_SECTION`             | **overview-doc-maintainer**    |
| `MISSING_SYSTEM_FILE`                  | **system-narrative-maintainer** |
| Stale `summary` / `description` on a route | **route-schema-doc-guard** |

## Anti-patterns

- ❌ Editing a `DOCS.md` file by hand — they're auto-generated; the next generator run wipes hand edits.
- ❌ Refreshing the baseline to mask a regression — only refresh after the count actually went down.
- ❌ Adding a `// @ts-expect-error` or similar suppression to bypass a TSDoc check — the generator does not parse types; suppression has no effect.

## Related references

- Generator entry point: [`src/scripts/codegen/generate-feature-docs.ts`](../../../src/scripts/codegen/generate-feature-docs.ts)
- Renderer + extractor library: [`tooling/feature-docs/`](../../../tooling/feature-docs/)
- Pre-commit step: `.husky/pre-commit` step 4d
- CI gates: `pnpm ci:local`, `pnpm ci:quality`
