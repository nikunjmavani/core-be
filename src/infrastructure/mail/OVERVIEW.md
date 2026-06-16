`src/infrastructure/mail/`

# Mail infrastructure

## Purpose

Outbound email pipeline: the mail outbox table (transactional outbox pattern), the BullMQ queue, the delivery processor wrapping Resend, and the sweeper that reclaims rows stuck in `sending`. HTML templates for transactional mail (magic link, password reset, email verification, organization invitation) live here too.

This module is **infrastructure**, not a domain — it offers `recordOutboxEmail()` + `dispatchOutboxEmail()` primitives (transactional outbox insert, then post-commit BullMQ dispatch) that any domain may call. Domains owning content (auth, tenancy, user) provide template inputs; this module owns delivery semantics.

## Design decisions

- **Transactional outbox pattern**: the originating service inserts into `mail_outbox` inside the same transaction that wrote the business row. The outbox sweeper / mail processor decouples delivery from the request lifecycle. See `transactional-outbox` in [src/PATTERNS.md](src/PATTERNS.md).
- **Atomic claim**: the worker uses `UPDATE mail_outbox SET status='sending' WHERE status='pending' RETURNING id` so two workers cannot claim the same row.
- **Stuck-row reclaim**: the sweeper reclaims rows stuck in `sending` for longer than `MAIL_OUTBOX_RECLAIM_SENDING_MINUTES` (default 30 — comfortably above worst-case delivery time) so a crashed worker doesn't strand outbox rows forever. This cutoff is deliberately larger than `MAIL_OUTBOX_SWEEP_PENDING_MINUTES` (default 15), which only governs the re-enqueue scan of `pending` rows.
- **Idempotent re-send**: each send passes a deterministic `Idempotency-Key` (`mail-outbox-<id>`) to Resend, so a worker that sent then crashed before marking `sent` is de-duplicated on reclaim instead of delivering twice (the outbox is at-least-once at the queue layer, exactly-once at the provider).
- **Resend over alternatives**: chosen for deliverability, simple API, signed webhook callbacks, and a free dev tier. Wrapped by [mail.service.ts](src/infrastructure/mail/mail.service.ts) with a circuit breaker (`opossum`) + Sentry.
- **HTML-first templates** with optional plaintext fallback. Templates live in [templates/](src/infrastructure/mail/templates/); the renderer interpolates locale-aware strings via i18next.
- **No body proxying through the API**: the outbound payload is constructed in the worker process; the API never speaks to Resend directly.

## Operational concerns

- **Per-attempt timeout**: enforced by the Resend client; final failures emit Sentry events.
- **Reclaim cadence**: scheduled via [src/infrastructure/queue/scheduler.ts](src/infrastructure/queue/scheduler.ts).
- **Dev mode**: when `RESEND_API_KEY` is unset, the worker logs the rendered email instead of sending — useful for local dev and tests.
- **DLQ**: `mail-dlq` and `mail-outbox-sweeper-dlq` capture final failures.

## External dependencies

- **Resend** — production transactional email provider (`RESEND_API_KEY`).

## Tuning parameters

- `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, `MAIL_REPLY_TO_ADDRESS`.
- `MAIL_OUTBOX_RECLAIM_SENDING_MINUTES = 30` (reclaim cutoff for stuck `sending` rows).
- `MAIL_OUTBOX_SWEEP_PENDING_MINUTES = 15` (re-enqueue scan cutoff for `pending` rows).
- `BULLMQ_DEFAULT_LOCK_DURATION_MS = 30 000`.

## Failure modes

- **Resend API timeout** → BullMQ retries with backoff; final failure → DLQ + Sentry. Mail outbox row stays for forensic value.
- **Worker crash mid-send** → row stuck in `sending`; sweeper reclaims after `MAIL_OUTBOX_RECLAIM_SENDING_MINUTES` and re-queues. The deterministic Resend idempotency key prevents a duplicate delivery if the crash happened after Resend accepted the message.
- **Disposable email rejected at the source domain (auth)** → never reaches the outbox.
- **Resend signs the outbound payload but the customer's email server bounces** → Resend captures the bounce; we don't inspect bounces today (future work to feed back into `user-notification-preferences`).
