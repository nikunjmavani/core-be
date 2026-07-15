`src/domains/tenancy/sub-domains/organization/organization-notification-policy/`

# Organization notification policies (nested resource)

Parent: [organization](../organization.overview.md)

## Purpose

CRUD over organization-scoped notification-delivery policies keyed by `(notification_type, channel)` — which notification types are delivered on which channels, and optional muting.

## Layout

- `organization-notification-policy.controller.ts` / `organization-notification-policy.service.ts` — thin HTTP + application layer
- `organization-notification-policy.repository.ts` / `organization-notification-policy.schema.ts` — persistence with a unique `(organization_id, notification_type, channel)` constraint
- `organization-notification-policy.dto.ts` / `organization-notification-policy.validator.ts` / `organization-notification-policy.serializer.ts` / `organization-notification-policy.types.ts` — request/response shaping
- `workers/` — tombstone-retention worker (hard-deletes soft-deleted policies after the retention window)
- `seed/` — seed contribution
- `__tests__/unit/` — validator/serializer/service/worker unit suites

## Key invariants

- Upsert resurrects a soft-deleted `(notification_type, channel)` row on conflict instead of failing or duplicating — one live policy per pair.
- Deletes are soft (`deleted_at`); hard deletion is exclusively the retention worker's job.
- `muted_until` accepts an ISO string at the boundary and is converted to a `Date` in the service before persistence.
