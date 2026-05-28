# Dead-letter queue (DLQ) runbook

When a BullMQ job exhausts retries, the worker copies a snapshot to **`<source-queue>-dlq`** (see [`dead-letter.ts`](../../src/infrastructure/queue/dlq/dead-letter.ts)). This runbook covers inspection and safe replay.

**Retention:** Dead-letter jobs are kept in Redis for **30 days** (age-based eviction via BullMQ `removeOnComplete` / `removeOnFail`), then automatically removed to prevent unbounded growth and OOM. Inspect and replay within this window — older entries are no longer recoverable from Redis.

## When to use

- `queue.dlq.depth.high` log or Sentry warning from the DLQ depth worker
- Bull Board shows growing `*-dlq` queues
- Known transient outage (Stripe, Resend, subscriber URL) is resolved and jobs should be retried

## Prerequisites

- `.env` with `DATABASE_URL` and `REDIS_URL` (same as worker)
- Root cause fixed — replaying poison jobs will fail again and refill the DLQ

## CLI: `pnpm tool:dlq-replay`

| Command | Purpose |
| ------- | ------- |
| `pnpm tool:dlq-replay -- --list` | List jobs in all **work** DLQs (`mail`, `webhook-delivery`, `notification`, `stripe-webhook`) |
| `pnpm tool:dlq-replay -- --list mail-dlq` | List jobs in one DLQ |
| `pnpm tool:dlq-replay -- --replay mail-dlq --job-id <id> --actor-user-public-id <usr> [--dry-run]` | Re-enqueue one job (writes `queue.dlq.replayed` audit row) and remove it from the DLQ |
| `pnpm tool:dlq-replay -- --replay-all webhook-delivery-dlq --actor-user-public-id <usr> --limit 10 [--dry-run]` | Replay up to N jobs |

Always run `--dry-run` first in production.

The full list of source queues (work + retention/cleanup + observability) is in [bull-board.md](../reference/runtime/bull-board.md#queues-shown). Tombstone-retention DLQs (`*-tombstone-retention-dlq`) are operationally rare; if they fill, escalate to engineering — there is no application-level replay path because retention deletions are idempotent and the next cron tick will retry the same row range.

## Per-queue replay guidance

| DLQ | Reconstructed job payload | If replay fails |
| --- | ------------------------- | --------------- |
| `mail-dlq` | `{ mailOutboxId }` from `original_data_summary` | Fix `auth.mail_outbox` row, then replay |
| `webhook-delivery-dlq` | `{ deliveryAttemptId, organizationPublicId }` | Fix URL/secret; create a new attempt if the row is terminal |
| `stripe-webhook-dlq` | `{ stripeEventId }` — worker fetches event from Stripe API | Reclaim ledger row (`pnpm tool:stripe-webhook-replay`) if needed |
| `notification-dlq` | Manual — inspect `original_data_summary` in Bull Board | Re-enqueue from application code or Bull Board **Retry** after fix |

## Operational checklist

1. Confirm DLQ depth alert or manual triage in Bull Board (`ENABLE_QUEUE_DASHBOARD=true`).
2. Identify `failed_reason` and `original_queue` on the DLQ job.
3. Fix code, config, or downstream service.
4. `pnpm tool:dlq-replay -- --list <queue-dlq>` — note job ids.
5. `pnpm tool:dlq-replay -- --replay <queue-dlq> --job-id <id> --actor-user-public-id <usr> --dry-run` then without `--dry-run`.
6. Watch source queue depth and worker logs; confirm DLQ count drops.
7. For Stripe billing events, cross-check `billing.stripe_webhook_events` processing status.

## Related

- [bull-board.md](../reference/runtime/bull-board.md) — dashboard triage
- [workers-and-events.md](../reference/runtime/workers-and-events.md) — DLQ wiring and shutdown order
- [worker-scaling.md](../deployment/runbooks/worker-scaling.md) — worker deploy and health
