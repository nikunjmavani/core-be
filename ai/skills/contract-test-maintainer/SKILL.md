---
name: contract-test-maintainer
description: Maintains outbound HTTP contract tests (Stripe, Resend, S3) under src/tests/contract/. Use when changing payment/mail/storage clients or adding nock fixtures.
---

# Contract test maintainer (core-be)

Keeps **nock + fixture** contract tests aligned with outbound integrations. See `docs/reference/testing/contract-tests.md`.

## When to use

- Changed `src/infrastructure/payment/stripe.client.ts`, mail, or storage wrappers
- Added/changed `src/tests/contract/**/*.contract.test.ts` or fixtures
- Stripe SDK or nock behavior changes (fetch client requirement)

## Layout

| Path                                    | Role                                    |
| --------------------------------------- | --------------------------------------- |
| `src/tests/contract/*.contract.test.ts` | Specs per integration                   |
| `src/tests/contract/fixtures/**`        | Curated JSON responses                  |
| `src/tests/contract/helpers/**`         | Stripe form-body matchers, shared setup |
| `tooling/vitest/contract.config.ts`     | Dedicated Vitest config                 |
| `src/tests/contract-vitest-setup.ts`    | nock preload                            |

## Commands

```bash
pnpm test:contract
```

Runs in **Quality** CI (`pnpm test:contract`). Default `pnpm test` **excludes** contract tests.

## Checklist

- [ ] `CONTRACT_TESTS_ONLY=true` path still works (global-setup skips DB when appropriate)
- [ ] Stripe uses **fetch HTTP client** under contract-only runs (see contract-tests doc)
- [ ] nock matchers handle `application/x-www-form-urlencoded` parsed bodies (`helpers/stripe-form.ts`)
- [ ] Fixtures updated when external API shape changes
- [ ] No real network in CI

## Related skills

- **production-hardening-guard** — circuit breakers on external clients
- **ci-investigator** — when Quality job contract step fails
