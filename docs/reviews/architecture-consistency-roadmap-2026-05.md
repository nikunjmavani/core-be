# Architecture consistency roadmap (archival)

> **Status:** All phases (1–3) completed May 2026. This is a **point-in-time snapshot**; do not rewrite history. For current layout rules, see [domains-and-public-api-design.md](../reference/architecture/domains-and-public-api-design.md) and [CLAUDE.md](../../CLAUDE.md).

Tracks the domain-layout consistency program: route metadata, validators, docs, Docker, and targeted tests.

---

## Phase 1 — Single source of truth (complete)

| ID  | Ticket                                                             | Status |
| --- | ------------------------------------------------------------------ | ------ |
| 1.1 | Choose generated registry strategy (Option A)                      | Done   |
| 1.2 | `pnpm routes:catalog` emits `docs/routes.txt`                      | Done   |
| 1.3 | `route-completeness.test.ts` — registry → Fastify via `hasRoute`   | Done   |
| 1.4 | Document auto-generated registry + layout variants (§1.4)          | Done   |
| 2.1 | Remove empty `__tests__/factories` placeholders                    | Done   |
| 3.1 | Layout variants table in `domains-and-public-api-design.md`        | Done   |
| 3.2 | Per-domain route-file strategy table                               | Done   |
| 4.1 | Remove `tenancy.service.ts` stub; relax multi-sub-domain invariant | Done   |
| 4.2 | `validate-domain.ts` warnings (depth, empty dirs, schema)          | Done   |
| 5.1 | `UserDataExportService` wired through `user.container`             | Done   |
| 6.1 | Log key `invalidate-organization` naming                           | Done   |
| 7.1 | PR / `CONTRIBUTING.md` route checklist                             | Done   |

**Outcome:** 133 routes in catalog/registry (billing + notify sub-routes, health, MCP).

---

## Phase 2 — Guardrails and coverage (complete)

| ID  | Ticket                                                     | Status | Notes                                                     |
| --- | ---------------------------------------------------------- | ------ | --------------------------------------------------------- |
| 2.1 | Inverse route parity test                                  | Done   | `captureRegisteredRoutes` + allowlist for `/admin/queues` |
| 2.2 | Route allowlist                                            | Done   | Bull Board only; MCP in catalog                           |
| 2.3 | Pre-commit auto-`routes:catalog` when `*.routes.ts` staged | Done   | `.husky/pre-commit`                                       |
| 2.4 | `validate:domain --strict` in CI + `ci:local`              | Done   | `pnpm validate:domain:strict`                             |
| 2.5 | MCP routes in generated catalog                            | Done   | `GET`/`POST` `/api/v1/mcp`                                |
| 2.6 | Targeted domain e2e tests                                  | Done   | Audit pagination, upload, billing webhook                 |

### Commands (Phase 2)

```bash
pnpm routes:catalog
pnpm routes:catalog:check
pnpm validate:domain:strict
pnpm test:global
```

---

## Phase 3 — Docs, Docker, observability (complete)

| ID  | Ticket                           | Status | Notes                                                                              |
| --- | -------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| 3.1 | OpenAPI drift check              | Done   | `pnpm docs:check` (gitignored `docs/openapi/`; CI + pre-commit when routes staged) |
| 3.2 | Observability log key doc        | Done   | [observability-log-events.md](../reference/reliability/observability-log-events.md)            |
| 3.3 | Per-domain integration test gate | Done   | `pnpm validate:domain:coverage`                                                    |
| 3.4 | Docker MCP assets + docs         | Done   | [deployment/docker-images.md](../deployment/docker-images.md)                      |
| 3.5 | Structure / index sync           | Done   | `docs/README.md`, roadmap, CONTRIBUTING                                            |

### Docker (required change)

The API **`Dockerfile`** now:

1. Runs `pnpm routes:catalog` and `pnpm docs:generate:multilang` in the **build** stage (host `docs/` is in `.dockerignore`).
2. Copies `docs/routes.txt` and `docs/openapi/` into the **runtime** image for MCP when `ENABLE_MCP_SERVER=true`.

**Follow-up:** Multi-target `Dockerfile` (`build` → `runtime` → `worker` / `api`); `Dockerfile.worker` duplicates worker build/runtime stages (no MCP); `docker-compose.yml` uses `restart: unless-stopped` on Postgres/Redis; API `HEALTHCHECK` uses Node `fetch` on `/health/ready`; CI builds and scans both API and worker images.

### Commands (Phase 3)

```bash
pnpm docs:check                 # OpenAPI generator drift (specs gitignored)
pnpm validate:domain:coverage   # Each domain has __tests__/*.test.ts (non-unit)
docker build -t core-be .       # Verify image build after route changes
```

---

## Related docs

- [domains-and-public-api-design.md](../reference/architecture/domains-and-public-api-design.md)
- [observability-log-events.md](../reference/reliability/observability-log-events.md)
- [deployment/docker-images.md](../deployment/docker-images.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
