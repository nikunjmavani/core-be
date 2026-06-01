`tooling/tsdoc-coverage/`

# TSDoc coverage gate

This is the canonical documentation gate for `core-be`. It enforces that
public exports in `src/**/*.ts` carry a TSDoc summary, and that exports in
service-like files (`*.service.ts`, `*.worker.ts`, `*.processor.ts`) and
policy-like files (`*.policy.ts`) also carry an `@remarks` block.

## Why TSDoc, not auto-generated DOCS.md

Per-symbol TSDoc is the **single source of truth** for documentation:

- IDE hover (Cursor, VS Code) reads it natively.
- Routes use Zod `schema.summary` / `schema.description`, which drive
  [docs/openapi/openapi.json](../../docs/openapi/openapi.json) — Postman and
  the API hub consume that, no separate route catalog needed.
- Hand-written `OVERVIEW.md` files at meaningful boundaries cover design
  decisions, failure modes, and tuning knobs that TSDoc can't carry.
- The system narrative lives in `src/{OVERVIEW,PATTERNS,FLOWS,POLICIES}.md`.

There is intentionally no auto-generated `DOCS.md` aggregator. The
`tooling/feature-docs/` system was retired; this gate replaces it.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm tsdoc:check` | Enforce the budget. Exits 1 if either count exceeds [`budget.json`](budget.json). |
| `pnpm tsdoc:check --report` | Same gate, plus a tab-separated `<file>\t<symbol>\t<needs>` line for every missing pair. |
| `pnpm tsdoc:check --refresh-budget` | Rewrite `budget.json` with the current counts. Use only after lowering counts. |

`needs` is one of `summary`, `remarks`, or `summary+remarks`.

## How the gate works

1. Walks `src/**/*.ts`, skipping test fixtures, sub-domains' shared helpers,
   and files matching test suffixes (`.test.ts`, `.spec.ts`, etc.).
2. For each file, finds top-level `export function|class|const|let|var|
   interface|type|enum` declarations using a regex pass.
3. Pairs each preceding `/** … */` block with the immediately following
   `export` (allowing whitespace between them).
4. A symbol counts as having a **summary** if any non-blank line precedes
   the first `@…` tag in the cleaned comment.
5. A symbol counts as having **remarks** if any line begins with
   `@remarks`.
6. Symbols carrying `@internal` are excluded.
7. The gate compares totals to [`budget.json`](budget.json) and fails if
   either count exceeds its locked budget.

## Burndown workflow

Counts are allowed to **decrease** but never **increase**. To lower them:

1. Add TSDoc summaries / `@remarks` to the offending exports.
2. Run `pnpm tsdoc:check --report` to see what is left.
3. When happy, run `pnpm tsdoc:check --refresh-budget` and commit the
   updated [`budget.json`](budget.json).

The eventual goal is `MISSING_DESCRIPTION = 0` and `MISSING_REMARKS = 0`.
The budget exists only because we are starting from a partially-documented
codebase; it is not a permanent feature.

## What is **not** in scope here

- Markdown rendering (deliberately removed — TSDoc is the source).
- Per-directory aggregator files (the retired `DOCS.md` layer).
- HTML browsing (defer to a follow-up TypeDoc setup if ever needed).
- Route documentation (lives in Zod schemas → OpenAPI; not handled here).
