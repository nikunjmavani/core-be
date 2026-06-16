`src/core/`

# Core

## Purpose

The in-process **event bus** and its handler-registration bootstrap — the seam between a
successful service write and its asynchronous side effects. A service finishes a write, emits a
`DomainEvent` on the bus, and registered handlers turn that event into queued work (email, webhook
delivery, notifications). Everything here runs inside the API process; durable execution happens
later in the BullMQ workers.

Two files live here:

- `events/event-bus.ts` — the `EventBus`, `DomainEvent` / `buildDomainEvent`, on-commit scoping
  (`runWithOnCommitScope`, `enterOnCommitScope`), and transactional commit-dispatch
  (`scheduleCommitDispatch`, `runEnqueueAfterCommit`).
- `events/register-event-handlers.ts` — the bootstrap-order aggregator that wires auth + tenancy
  email handlers **before** routes are registered.

## Design decisions

- **In-process bus over an external broker for domain events.** Domain events fire synchronously
  after a service write and only ever enqueue durable work; they never carry the side effect
  themselves. Postgres + BullMQ remain the durability layer, so the bus stays a thin, dependency-free
  dispatcher rather than another piece of infrastructure to operate.
- **On-commit scoping so side effects enqueue only after the DB transaction commits.** Without it, a
  handler could enqueue an email for a write that later rolls back. `runWithOnCommitScope` /
  `scheduleCommitDispatch` defer the enqueue until commit, so queued work always reflects committed
  state. The commit-dispatch internals are tested under
  `src/infrastructure/queue/commit-dispatch/`.
- **Two registration paths, chosen by dependency need.** Handlers that only need the mail enqueue primitives `recordOutboxEmail()`/`dispatchOutboxEmail()` (or
  no container deps) register in `register-event-handlers.ts`, which runs before routes. Handlers that
  need repositories from the composition root (notify webhook delivery, billing subscription
  listeners) register in their domain's `register*Container()`. This keeps bootstrap order correct
  without giving the bus a hard dependency on the DI container.
- **Handlers must not fail the HTTP request.** A handler that throws is logged and swallowed — the
  originating request still succeeds. Reliability for the side effect comes from the queue (retries,
  DLQ) and the commit-dispatch recovery worker, not from blocking the user's request.

## Failure modes

- **Handler throws** → logged, swallowed; the HTTP request still returns success. The side effect is
  recovered by queue retries / the commit-dispatch recovery worker, not by the request path.
- **Process crashes after commit but before enqueue** → the commit-dispatch recovery worker
  (`commit-dispatch-recovery`) replays stale dispatch rows so the side effect is not lost.
- **Handler registered on the wrong path** (needs a repo but registered pre-routes) → fails at
  bootstrap with a missing-dependency error; caught before serving traffic.
