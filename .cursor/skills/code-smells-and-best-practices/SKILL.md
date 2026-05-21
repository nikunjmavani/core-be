---
name: code-smells-and-best-practices
description: When adding or modifying code in src/, fix ESLint issues in touched files. Full validate runs on pre-commit and CI — do not duplicate. Uses lint-warnings-handler for warning details.
---

# Skill: Code Smells and Best Practices

## Purpose

Single owner for **code quality** under `src/`. Fix issues in files you change. Pre-commit and CI enforce full-repo lint, format, and types — do not run `pnpm lint` + `pnpm typecheck` on every small edit unless the hook failed or you are closing a large task.

## Rule

**Zero new lint errors or warnings in files you edited.** Resolve issues before finishing the task.

## Checklist

1. **Fix ESLint issues** in touched files (errors always; warnings per guidance below and in `.cursor/skills/lint-warnings-handler/SKILL.md`).
2. **Full-repo checks** — only when:
   - Pre-commit or CI failed → use **before-commit-guard**
   - Large PR-sized change before handoff → `pnpm validate`
3. **Do not ask the user** how to fix warnings — apply guidance and move on.

## Code smells and fixes

### Lint errors (must fix)

- **consistent-type-imports**: Use `import type` for type-only imports (e.g. `import type { z } from 'zod'`).
- **security/detect-unsafe-regex**: Use bounded patterns or add `eslint-disable` with justification (`-- bounded env key pattern`).
- **security/detect-object-injection**: Use typed keys or allowlist; add disable with reason when keys are from validated schema or server-controlled data.

### Lint warnings (prefer fixing)

- **max-lines-per-function**: Split long functions; use disable with reason only for route aggregators, test suites, CLI entry.
- **sonarjs/no-duplicate-string**: Extract repeated strings to constants.
- **sonarjs/cognitive-complexity**: Simplify conditionals, extract helpers.
- **no-console**: Use `logger` from `@/shared/utils/infrastructure/logger.util.js`; allow console only in standalone CLI scripts.

### Best practices

- Prefer `import type` for type-only imports.
- Avoid unnecessary `as` type assertions; use proper typing or Zod schemas where possible.
- Use Zod `parse()` instead of `safeParse` + `as` in validators when the function always throws on invalid input.
- Keep functions under ~100 lines; extract helpers when logic grows.

## Relation to other skills

- **lint-warnings-handler**: Per-warning resolution guide (detail only — not a separate trigger).
- **before-commit-guard**: When `git commit` or CI fails.
- **structure-maintainer**: When adding/renaming files or directories.
- **route-catalog**: When adding/removing routes (`pnpm routes:catalog` once; CI `routes:catalog:check` verifies).

## Scope

- Applies to all TypeScript under `src/`.
