`src/tests/unit/`

# Unit tests

## Purpose

Pure-function and class-under-mocks tests with no external dependencies. Vitest project: `unit` (configured in [tooling/vitest/projects.ts](tooling/vitest/projects.ts)).

Covers: domain validators, serializers, error mapping, response shaping, util functions, composition-root smoke checks, and CI helper logic. Tests under `src/domains/<domain>/__tests__/unit/` are also included in this Vitest project — co-located unit tests live with their domain.

What this suite does **not** cover: HTTP routes (see `e2e/`, `integration/`), worker behavior with Redis (see `integration/`), Postgres-backed flows (see `integration/`).

## Test types

- **Pure-function tests** — utilities, validators, serializers, parsers.
- **Class-under-mocks tests** — services with all dependencies stubbed.
- **Composition-root smoke tests** (`composition-root/`) — verify the DI container assembles correctly without invoking any real I/O.
- **CI helper tests** (`ci/`) — exercises the codegen / lint helpers used by CI.

## How to run

```bash
pnpm test:unit                  # all unit tests
pnpm test:unit -- <path>        # a single file
pnpm test:unit -- --watch       # watch mode
```

## Fixtures and helpers

- Vitest setup: `setup.ts` at suite root configures the test environment without booting Fastify or opening DB connections.
- Mocks live alongside the file under test or in [src/tests/factories/](src/tests/factories/) when shared across suites.

## Dependencies

None. Unit tests must not require Postgres, Redis, network, or filesystem fixtures beyond what's bundled in the repo. CI runs them in the static / quality slice without booting the compose stack.

## Failure modes

- **Unit test that secretly hits the network** → fails in offline CI; debugged by running the file in isolation with no `DATABASE_URL` set.
- **Snapshot drift** when a serializer adds a new field → re-run with `-u` after reviewing the diff.
- **Composition-root smoke fails** after a domain refactor → typically a missing wire in `*.container.ts` or a missing `register*Container()` call.
