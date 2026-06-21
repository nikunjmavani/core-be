`src/domains/notify/sub-domains/notification/`

# Notification

Parent: [notify](../../OVERVIEW.md)

## Purpose

In-app notification rows: the user-visible feed that surfaces "subscription went past due", "you were invited to organization X", etc. Cross-domain event handlers create rows here; users mark them read or dismiss them via the API.

## Key invariants

- **One notification per `(user, source_event_id)`**: dedupe at insert time so the same domain event cannot produce two rows for the same recipient.
- **Idempotent dispatch enqueue**: the dispatch job uses `jobId = notification-<id>`, so a recovery/redelivery re-enqueue of the same persisted notification is a BullMQ no-op within the retention window — one notification row never fans out (or emails) twice.
- **Bounded mark-all-read**: `markAllReadForUser` marks the unread backlog in `NOTIFICATION_MARK_ALL_READ_BATCH_SIZE`-row batches (looping until drained), so a huge backlog cannot become one unbounded, long-held write that stalls concurrent inserts for that user; the returned count is summed from each statement's `RETURNING` (never a separate pre-count).
- **Email outcome is honest**: the worker reports `email:outbox_pending` (not `email:queued`) when the mail-outbox row persisted but its BullMQ enqueue failed — the mail-outbox sweeper re-enqueues it and the `mail_outbox_pending` gauge tracks the depth.
- **Tenant-scoped**: notifications belong to a `(user, organization)` pair. Reads are scoped through the standard tenant context.
- **Read state is monotonic**: `unread → read → dismissed`. Marking a dismissed notification "unread" is not allowed.
- **Best-effort fan-out**: a notification fan-out failure does not roll back the originating transaction (it's a downstream side effect).

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> unread: handler created notification
  unread --> read: user opens notification
  read --> dismissed: user dismisses
  unread --> dismissed: user dismisses without reading
  dismissed --> tombstoned: retention sweep after window
  tombstoned --> [*]
```

## Events

- Consumes: `BILLING_EVENT.SUBSCRIPTION_PAST_DUE`, `BILLING_EVENT.SUBSCRIPTION_CANCELED`, `MEMBER_INVITATION_EVENT.*`, etc.

## Failure modes

- **Worker crash during fan-out** → BullMQ retries; idempotent insert dedupes on `(user, source_event_id)` so retries cannot double-create.
- **Recipient user soft-deleted** → notification is skipped, logged at info.
