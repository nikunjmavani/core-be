<!--
  PR title must follow Conventional Commits (used by release-please + commitlint):
    type(scope): short subject
  Examples: feat(auth), fix(billing), ci, docs, refactor(tenancy), perf(notify)
-->

## Summary

<!-- AI: fill structured bullets from commits / diff; link issue (Closes #123) when applicable. -->

- **What:** <!-- one line -->
- **Why:** <!-- one line -->
- **Risk:** <!-- low | medium | high -->

## Release type

<!--
  Pick exactly one. This drives release-please's bump on dev/main.
  PR title prefix must match — `feat:` for minor, `fix:`/`perf:`/`refactor:` for patch,
  `<type>!:` (or `BREAKING CHANGE:` footer) for major.
  AI: feat=Minor, fix/perf/refactor=Patch, type!=Major, docs/ci/chore/test/style=No release
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
- [ ] `pnpm routes:catalog:check` (if routes changed)
- [ ] `pnpm docs:check` (if OpenAPI inputs changed)
- [ ] `pnpm db:migrate:lint` (if migrations changed)
- [ ] `pnpm tool:sync-env-example` (if env schema changed)
- [ ] Additional checks specific to this change (manual smoke, chaos, etc.)

## Reviewer notes

<!-- AI: prefill so reviewers know where to focus; use "none" when not applicable. See docs/process/pr-review.md -->

- **Architecture:** <!-- none | layer change in domain X -->
- **Schema:** <!-- none | migration added -->
- **Security:** <!-- none | new auth surface | RLS touched -->
- **Performance:** <!-- none | index added | hot-path change -->
- **Tests:** <!-- none | unit/e2e added | factory updated -->
- **Docs touched:** <!-- none | list paths -->

## Breaking changes

<!-- Required when Release type = Major. Otherwise write "None". Describe impact and migration steps. -->

---

Reviewers: see [docs/process/pr-review.md](../docs/process/pr-review.md).
