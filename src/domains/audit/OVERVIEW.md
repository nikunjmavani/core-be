`src/domains/audit/`

# Audit

## Purpose

Append-only audit log of every security- and governance-relevant action that happens on the platform: who did it (actor), what they did (action), to what (resource), from where (IP, user-agent), with what severity, and any structured metadata. The domain owns the canonical write path used by the `audit-emission` cross-cutting pattern, and exposes a global-admin-only read API for forensic and compliance queries.

What it owns:

- The `audit_logs.audit_log` table, its schema, and its retention policy.
- The single `AuditService.record()` write entry-point that all other domains call (directly or through `recordAuditEvent` helper).
- The `GET /api/v1/audit/logs` cursor-paginated read endpoint (global-admin only).

What it does not own: deciding **when** to emit an audit event — that's the responsibility of each calling domain. Audit only enforces the shape, the durability, and the read contract.

## Key invariants

- **Append-only**: rows are never updated or deleted by the API. Hard-delete only happens via the retention worker after the retention window passes.
- **Best-effort writes**: an audit failure must not fail the originating HTTP request. Callers go through `recordAuditEvent(auditService, input, log)` from `@/shared/utils/infrastructure/audit-record.util.ts`, which catches and logs failures.
- **Actor-scoped RLS**: writes run inside `withUserDatabaseContext(actorUserPublicId, ...)` so RLS sees the actor's organization scope, not the caller's.
- **Read-restricted**: read endpoints require global `admin` or `super_admin` role — never an organization-level permission. There is no per-tenant audit read path today.
- **Severity is a fixed set**: `INFO` (default), `WARNING` (denied/failed actions still worth recording), `CRITICAL` (global-admin lifecycle and security-incident events).

## Sub-domains

`audit` is a flat domain — no `sub-domains/` folder. The single resource lives at the domain root (`audit.service.ts`, `audit.repository.ts`, `audit.routes.ts`, etc.). Per-symbol docs are in TSDoc on each export (use IDE hover or `pnpm tsdoc:check --report`).

## Patterns used

This domain implements the contracts documented in [src/PATTERNS.md](src/PATTERNS.md):

- `audit-emission` — the domain **is** this pattern's owner; other domains call into `AuditService.record()` (or the helper) to participate.
- `tenant-isolation` / `rls-context` — actor-scoped writes run inside the actor's user database context so RLS attributes the row to the correct organization.
- `soft-delete` does **not** apply: audit rows are immutable until retention purges them.

## Cross-domain flows

Every cross-domain flow in [src/FLOWS.md](src/FLOWS.md) emits at least one audit row through this domain:

- `signup-flow`, `login-flow` — identity lifecycle events.
- `organization-invitation-flow` — invitation create/accept/cancel.
- `subscription-change-flow`, `dunning-flow` — billing state transitions.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> recorded: AuditService.record()
  recorded --> retained: row visible until retention window
  retained --> purged: retention worker hard-deletes after window
  purged --> [*]
```

## Events

This domain neither emits nor consumes domain events. Audit is a pure write target — the `event-bus` is upstream of it.

## Failure modes

- **Unknown actor public id** → logged at `warn` (`audit.record.unknownActorUserPublicId`); no row written; originating request is unaffected.
- **DB write failure** → caught by `recordAuditEvent`, logged at `warn`; originating request is unaffected.
- **Read endpoint without global admin role** → 403; no information is leaked about whether the requested filter would have matched any rows.
