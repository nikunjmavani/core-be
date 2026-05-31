---
name: lint-warnings-handler
description: Detail guide for resolving Biome lint warnings. Invoked by code-smells-and-best-practices only — not a separate auto-trigger. Handle warnings yourself; prefer fixing over disabling.
---

# Lint warnings handler (core-be)

## Purpose

**Detail guide** for Biome lint warnings. The **code-smells-and-best-practices** skill owns quality for `src/` edits; read this file when you need per-rule fix patterns. **Do not ask the user** how to handle a warning—apply the guidance below.

## Rule

**Zero new warnings in files you edited.** Pre-commit (`lint-staged`) and CI (`pnpm validate`) enforce the full repo; fix warnings inline in touched files without re-running full lint unless the hook failed.

## How to resolve each warning type

### 1. `sonarjs/no-duplicate-string` (Define a constant instead of duplicating this literal)

- **Prefer:** Extract the repeated string to a named constant at module or function scope.
- **Where:** At the top of the file (after imports) or in a small `const` block.
- **Example:** If `/api/v1/auth` appears 4+ times, add `const AUTH_PREFIX = '/api/v1/auth' as const;` and use `AUTH_PREFIX`.
- **Exception:** If the literal appears only in one test and extracting would hurt readability, you may add `// eslint-disable-next-line sonarjs/no-duplicate-string` with comment `single use in test`.

### 2. `max-lines-per-function` (Function has too many lines)

- **Prefer:** Split the function into smaller helpers (same file or extracted module). Keep route handlers under ~80 lines when possible.
- **Exception:** Route aggregators (`*Routes` that register many sub-routes), large test `describe` callbacks, and CLI script entry functions may use:
  `// eslint-disable-next-line max-lines-per-function -- route aggregator` (or `-- test suite`, `-- CLI entry`).

### 3. `security/detect-object-injection` (Generic Object Injection Sink)

- **Prefer:** Use a typed map, `Record<KnownKey, T>`, or allowlist of keys. Avoid `obj[userInput]` when userInput is untrusted.
- **When safe:** Keys are from an enum, validated schema, or static list (e.g. parsing OpenAPI spec). Add:
  `// eslint-disable-next-line security/detect-object-injection -- keys from validated schema` (or similar).
- **Never disable** when the key is raw request input without validation.

### 4. `no-console` (Only warn, error allowed)

- **Prefer:** Use `logger` from `@/shared/utils/infrastructure/logger.util.js` (e.g. `logger.info`, `logger.warn`, `logger.error`).
- **Exception:** Standalone CLI scripts (e.g. `validate-domain.ts`, `upload-postman-collection.ts`) that run outside the app and need stdout: use `// eslint-disable-next-line no-console -- CLI script output`.

### 5. `complexity` / `sonarjs/cognitive-complexity`

- **Prefer:** Simplify conditionals, extract helpers, use early returns or lookup tables.
- **Exception:** Complex but stable logic (e.g. OpenAPI field mapping) may use:
  `// eslint-disable-next-line complexity -- structured mapping` and the same for `sonarjs/cognitive-complexity` if needed.

### 6. `sonarjs/no-identical-functions`

- **Prefer:** Extract shared logic into one function and call it from both places, or factor a small helper.

### 7. `sonarjs/no-collapsible-if`, `sonarjs/prefer-single-boolean-return`

- **Prefer:** Collapse conditionals or return a single boolean expression as the rule suggests.

## Checklist before finishing

1. Run `pnpm lint` and ensure no **new** warnings in modified files.
2. If you added an eslint-disable, the comment must state the **reason** (e.g. `-- route aggregator`, `-- CLI script`, `-- keys from schema`).
3. Do not introduce new `any` or unsafe regex; those remain errors.

## Scope

- Applies to all TypeScript under `src/`.
- When in doubt, fix the cause rather than disabling the rule.
