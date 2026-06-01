`src/domains/notify/sub-domains/notification/`

# Notification

Parent: [notify](../../OVERVIEW.md)

## Purpose

In-app notification rows: the user-visible feed that surfaces "subscription went past due", "you were invited to organization X", etc. Cross-domain event handlers create rows here; users mark them read or dismiss them via the API.

## Key invariants

- **One notification per `(user, source_event_id)`**: dedupe at insert time so the same domain event cannot produce two rows for the same recipient.
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
