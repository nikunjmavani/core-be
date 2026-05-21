## What changed

<!-- Describe the changes in 1-3 sentences -->

## Why

<!-- Explain the motivation behind this change -->

## Related issue

<!-- e.g. Closes #123 -->

## Type

- [ ] Feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Refactor (`refactor`)
- [ ] Documentation (`docs`)
- [ ] Tests (`test`)
- [ ] CI/CD (`ci`)
- [ ] Chore (`chore`)
- [ ] Performance (`perf`)
- [ ] Build / tooling (`build`)
- [ ] Revert (`revert`)

## Affected domains

- [ ] auth (`src/domains/auth/`)
- [ ] billing (`src/domains/billing/`)
- [ ] tenancy (`src/domains/tenancy/`)
- [ ] user (`src/domains/user/`)
- [ ] notify (`src/domains/notify/`)
- [ ] audit (`src/domains/audit/`)
- [ ] upload (`src/domains/upload/`)
- [ ] infrastructure (`src/infrastructure/`)
- [ ] shared (`src/shared/`)

## Testing

<!-- What did you run (unit, e2e, manual)? List commands or scenarios. -->

## Checklist

- [ ] `pnpm validate`
- [ ] `pnpm validate:domain:strict`
- [ ] `pnpm validate:domain:coverage`
- [ ] `pnpm ci:local` (or individual checks below if you prefer)
- [ ] `pnpm routes:catalog` then commit `docs/routes.txt` (if routes or access control changed)
- [ ] `pnpm docs:check` passes (if routes or OpenAPI metadata changed; regenerates gitignored `docs/openapi/` locally)
- [ ] `pnpm routes:catalog:check` (if routes changed)
- [ ] `pnpm db:migrate:lint` (if `migrations/` changed)
- [ ] `pnpm tool:sync-env-example` (if environment schema vars changed)
- [ ] `pnpm test`
- [ ] User-facing messages use i18n keys (see `.cursor/skills/i18n-message-guard/SKILL.md`)
- [ ] No secret `.env` files included (committed templates: `.env.example`, `.env.*.example` only)
- [ ] PR size is reasonable (< 500 lines preferred)
- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (used by release-please)

## Breaking changes

<!-- If none, write “None”. If any, describe impact and migration steps. -->
