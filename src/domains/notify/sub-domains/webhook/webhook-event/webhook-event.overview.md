`src/domains/notify/sub-domains/webhook/webhook-event/`

# Webhook event catalog (nested resource)

Parent: [webhook](../webhook.overview.md)

## Purpose

Read-only catalog of the webhook event types the platform can dispatch, served to the dashboard so users can pick which events a webhook subscribes to (`GET /webhook-events`).

## Layout

- `webhook-event.controller.ts` / `webhook-event.service.ts` — thin HTTP + application layer
- `webhook-event.repository.ts` — in-memory repository over the static `AVAILABLE_WEBHOOK_EVENTS` catalog (no database table)
- `webhook-event.serializer.ts` / `webhook-event.types.ts` — response shaping + domain types
- `seed/` — bulk-seed contribution (event-type picks for seeded webhooks)
- `__tests__/unit/` — controller, service, and serializer-shape unit suites

## Key invariants

- Intentionally has **no** `.schema.ts` / `.dto.ts` / `.validator.ts`: the catalog is static in-memory data and the only route takes no params or body. If the catalog ever moves to the database, add a schema and (if relevant) a query DTO/validator.
- Catalog entries are emitted by the producing domains; this folder only lists them — dispatch lives in the sibling [webhook-delivery](../webhook-delivery/webhook-delivery.overview.md) resource.
