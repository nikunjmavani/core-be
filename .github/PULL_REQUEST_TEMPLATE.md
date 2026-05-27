<!--
  PR title must follow Conventional Commits (used by release-please + commitlint):
    type(scope): short subject
  Examples: feat(auth), fix(billing), ci, docs, refactor(tenancy), perf(notify)
-->

## Summary

<!-- 1-3 sentences: what changed and why. Link the issue (Closes #123) if applicable. -->

## Release type

<!--
  Pick exactly one. This drives release-please's bump on dev/main.
  PR title prefix must match — `feat:` for minor, `fix:`/`perf:`/`refactor:` for patch,
  `<type>!:` (or `BREAKING CHANGE:` footer) for major.
-->

- [ ] **Patch** — bug fix / perf / non-breaking refactor (`fix:`, `perf:`, `refactor:`)
- [ ] **Minor** — new feature, backward compatible (`feat:`)
- [ ] **Major (breaking)** — `feat!:` / `fix!:` / `BREAKING CHANGE:` footer
- [ ] **No release** — docs / ci / chore / test / style only

## Expected result

<!-- The observable behavior or CI signal after this lands. Bullet points are fine. -->

## Test plan

- [ ] `pnpm validate` (lint + format + typecheck)
- [ ] `pnpm test` (or the targeted suite)
- [ ] `pnpm ci:local` for PR-gate parity (optional)
- [ ] Additional checks specific to this change (e.g. `pnpm routes:catalog:check`, `pnpm db:migrate:lint`, manual smoke)

## Breaking changes

<!-- Required when Release type = Major. Otherwise write "None". Describe impact and migration steps. -->
