<!--
  PR title must follow Conventional Commits (used by release-please + commitlint):
    type(scope): short subject
  Examples: feat(auth), fix(billing), ci, docs, refactor(tenancy), perf(notify)
-->

## Summary

<!-- 1-3 sentences: what changed and why. Link the issue (Closes #123) if applicable. -->

## Expected result

<!-- The observable behavior or CI signal after this lands. Bullet points are fine. -->

## Test plan

- [ ] `pnpm validate` (lint + format + typecheck)
- [ ] `pnpm test` (or the targeted suite)
- [ ] `pnpm ci:local` for PR-gate parity (optional)
- [ ] Additional checks specific to this change (e.g. `pnpm routes:catalog:check`, `pnpm db:migrate:lint`, manual smoke)

## Breaking changes

<!-- None, or describe impact and migration steps. -->
