---
name: workers-events
description: Implements and maintains core-be patterns for domain events, BullMQ queues, and worker processes (Redis-backed). Use when adding event emission in services, registering handlers, defining queues/jobs, implementing workers, or handling graceful shutdown and retries.
---

# Workers + events (EventBus + BullMQ)

## Core pattern

- **Services emit domain events** (in-process) after successful DB writes.
- **Event handlers enqueue BullMQ jobs** for side effects.
- **Workers process jobs** (pull-based) and interact with integrations/DB as needed.

Event handler failure must **not** fail the HTTP request (log and continue).

## Naming conventions

- **Event types**: `"<domain>.<verb>"` (e.g. `organization.created`)
- **Queue names**: `"<domain>"` (e.g. `organization`)
- **Job names**: `"<domain>.<action>"` (e.g. `organization.created`)
- **Payload fields**: prefer **snake_case** for identifiers in event payloads (e.g. `organization_id`, `created_by`)
- **Full names only**: `repository` not `repo`, `organization` not `org`, `database` not `db`

## Default resilience settings

- `attempts: 3`
- exponential backoff starting at 1000ms
- `removeOnComplete` capped
- `removeOnFail` capped

## Files/locations

- Event bus: `src/core/events/event-bus.ts`
- Queue infrastructure (**connection**, **scheduler** for repeatable retention jobs, **dead-letter** for `<source-queue>-dlq` + final-failure Sentry, **bootstrap**): `src/infrastructure/queue/connection.ts`, `src/infrastructure/queue/scheduler.ts`, `src/infrastructure/queue/dead-letter.ts`, `src/infrastructure/queue/bootstrap.ts`
- Worker options (stalled job config): `src/infrastructure/queue/worker-options.ts` — use `getDefaultWorkerOptions()`, `getWebhookWorkerOptions()`, or `getRetentionWorkerOptions()` so lock duration and stall handling are explicit; subscribe to `worker.on('stalled', ...)` for logging
- Redis client: `src/infrastructure/cache/redis.client.ts`
- Domain event aggregator: `src/domains/<domain>/events/index.ts` → calls sub-domain `register*EventHandlers()`
- Event types + handlers: `src/domains/<domain>/sub-domains/<sub-domain>/events/*` (or nested: `sub-domains/<parent>/<child>/events/*`)
- Queue definitions + enqueue helpers: `src/domains/<domain>/sub-domains/<sub-domain>/queues/*` (same nesting rule)
- Workers: `src/domains/<domain>/sub-domains/<sub-domain>/workers/*` (or nested path; or domain root `workers/` for flat domains like `user`)
- Worker entrypoint: `src/worker.ts`

**Important**: Queue infrastructure lives in `src/infrastructure/queue/` and only wires Redis, **central repeatable-job registration** (`scheduler.ts`), **dead-letter** (`dead-letter.ts`) + worker DLQ/Sentry hooks from `bootstrap.ts`, and worker startup. **Processor** logic and **event-driven** queue definitions + enqueue helpers must reside in their respective domain sub-domains, **not** in infrastructure or shared.

- **Repeatable / cron jobs (retention cleanup):** register every `upsertJobScheduler` entry in `src/infrastructure/queue/scheduler.ts` only. Domain worker files define the `Worker` processor only (same queue name as in `scheduler.ts`).

For a visual flow diagram (Service → EventBus → Handler → Queue → Redis → Worker), see `README.md` § Architecture Diagrams → Event-Bus and BullMQ Flow.

## Dead-letter queue and alerting

- After a job exhausts BullMQ retries (`job.attemptsMade >= (job.opts.attempts ?? 1)`), `attachDeadLetterAndAlerting` (wired from `bootstrap.ts` for each worker) enqueues a **`dead-letter`** job to **`<source-queue-name>-dlq`** with a **snake_case** payload snapshot (`original_queue`, `original_job_id`, `original_data`, `failed_reason`, …).
- **Transient** failures log `queue.job.retry` at **warn**; **final** failures log `queue.job.final_failure`, enqueue the DLQ job, and send **one** Sentry event per failure (fingerprint `worker_final_failure` + queue + job name). Do **not** call `captureException` from individual `worker.on('failed')` handlers — that duplicates noise across retries.
- Workers return `{ worker, queueName, close }` (see `WorkerHandle` in `bootstrap.ts`) so bootstrap can attach the hook; the repeatable-job **scheduler** handle has `close` only.
- Bull Board (`queue-dashboard.ts`) lists each `-dlq` queue next to its source queue when the dashboard is enabled.
- On worker shutdown, `closeDeadLetterQueues()` runs after worker handles close (see `src/worker.ts`).

## Canonical examples

**Tenancy — member invitation**

```
member-invitation.service.ts  →  eventBus.emit(tenancy.member_invitation.created|resent)
tenancy/sub-domains/membership/member-invitation/events/*.ts  →  enqueueEmail()
tenancy/events/index.ts  →  registerTenancyEventHandlers()
```

**Auth — transactional email** (magic link, password reset, email verification)

```
magic-link.service.ts / auth-method.service.ts  →  eventBus.emit(auth.*.requested)
auth/sub-domains/auth-method/events/*.ts  →  enqueueEmail()
auth/events/index.ts  →  registerAuthEventHandlers()
```

**Notify — cross-domain notifications** (billing subscription lifecycle)

```
stripe-webhook / subscription.service  →  emit billing.subscription.created|updated|canceled|payment_failed
notify/sub-domains/notification/events/billing-notification.event-handlers.ts  →  createAndDispatchNotification()
```

**Notify — outbound webhook delivery**

```
emitWebhookDeliveryRequested()  →  notify/sub-domains/webhook/events/
notify/sub-domains/webhook/events/webhook-delivery.event-handlers.ts  →  enqueueWebhookDeliveryByAttemptId()
billing events  →  notify/sub-domains/webhook/events/billing-webhook.event-handlers.ts
```

**Notify — direct enqueue** (unused today): `notification.service.dispatchNotification()` → `enqueueNotification()` for rows that already exist.

`src/core/events/register-event-handlers.ts` calls each domain’s `register*EventHandlers()` (from `buildApp()` before routes).

## Implementation checklist

1. **Emit**
   - In the service method (after DB create/update), call `eventBus.emit({ type, payload, timestamp })` with snake_case payload fields.

2. **Handle**
   - Register handler once at startup via `registerEventHandlers()` in `src/core/events/register-event-handlers.ts` (invoked from `buildApp()`).
   - Handler should:
     - validate payload shape
     - enqueue job
     - catch/log errors (do not throw up to HTTP path)

3. **Work**
   - Worker should:
     - switch on `job.name`
     - log structured metadata (job id, organization id, etc.)
     - be idempotent when possible
   - **Database access in workers/processors** (never `getRequestDatabase()` or `request-database.context` imports):
     - Type handles via `PostgresDatabaseHandle` / `WorkerDatabaseHandle` in `src/infrastructure/database/database-handle.types.ts` and `worker-processor.util.ts`
     - **Runtime guard:** `src/worker.ts` sets `CORE_BE_RUNTIME=worker`. Unpinned `getRequestDatabase()` throws `WorkerDatabaseContextError`. Context kind is tracked in `worker-database-context.ts` (ALS).
     - Use `runTenantScopedWorkerJob`, `runGlobalRetentionWorkerJob`, or `runUserScopedWorkerJob` from `worker-processor.util.ts`, or `createTenantScopedBullMQWorker` for tenant-scoped queues, or call the context wrappers directly
     - Tenant-scoped jobs → `withOrganizationContext(organizationPublicId, (databaseHandle) => …)` — pins ALS + `SET LOCAL app.current_organization_id`
     - Global tombstone/retention → `withGlobalRetentionCleanupDatabaseContext((databaseHandle) => …)` — `app.global_retention_cleanup`
     - GDPR export → `withUserDatabaseContext(userPublicId, (databaseHandle) => …)` — `app.current_user_id`
     - Session cleanup → `withSessionRetentionCleanupDatabaseContext((databaseHandle) => …)` — `app.session_retention_cleanup`
     - Mail outbox + Stripe webhook ledger (no tenant RLS) → `withSystemTableWorkerContext((databaseHandle) => …)` in processors/workers
     - Pass `databaseHandle` into `createWorker*Repository(databaseHandle)` factories; factories call `assertWorkerDatabaseContext` for the expected kind

4. **Bootstrap**
   - Register repeatable retention schedules in `src/infrastructure/queue/scheduler.ts` (wired from `bootstrap.ts`).
   - Register domain workers in `src/infrastructure/queue/bootstrap.ts` (called from `src/worker.ts`).

5. **Shutdown**
   - On SIGTERM/SIGINT:
     - close BullMQ workers (drain)
     - close dead-letter `Queue` clients (`closeDeadLetterQueues`)
     - close Redis connection
     - exit with code 0

## Don'ts

- Don't call integrations directly from services (emit events instead).
- Don't push jobs from HTTP controllers; keep it in services/events so behavior stays consistent across entrypoints.
- Don't place **processor** implementations in `src/infrastructure/queue/` — they belong in `src/domains/<domain>/<sub-domain>/workers/*`. Event-driven **queue + enqueue** helpers belong in `src/domains/<domain>/<sub-domain>/queues/*`. Exception: `scheduler.ts` registers repeatable **`upsertJobScheduler`** entries only (no processors).
- Don't call `getRequestDatabase()` from workers, processors, or `batch-delete.util.ts` — ESLint blocks `request-database.context` and global `database` pool imports there; use explicit handles from context wrappers and `createWorker*Repository` factories.
