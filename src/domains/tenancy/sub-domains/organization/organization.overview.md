`src/domains/tenancy/sub-domains/organization/`

# Organization

Parent: [tenancy](../../tenancy.overview.md)

## Purpose

The top-level tenancy aggregate. Owns the `organizations` table (id, public id, slug, name, status, settings JSON, billing customer id) and the child resources that share its lifecycle: `organization-settings`, `organization-notification-policy`, and `organization-api-key`.

## Key invariants

- **Slug is unique and URL-safe**: matches `SLUG_REGEX`, lowercased, no leading/trailing/consecutive hyphens.
- **Public id is the API contract**: 21-char URL-safe; the internal numeric id never appears in URLs or JSON.
- **Slug change is rare and audited**: changing the slug rewrites organization-scoped URLs for clients; recorded with `WARNING` severity in audit.
- **Organization soft-delete cascades to child resources**: settings, API keys, and notification policy tombstone with the organization. Memberships are handled separately.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> active: organization created
  active --> active: slug change, settings update, API key issuance
  active --> tombstoned: soft delete
  tombstoned --> [*]: retention worker purges children + organization after window
```

## Events

This sub-domain neither emits nor consumes domain events directly. State changes are reflected through audit-emission only.

## Failure modes

- **Slug collision** on create or rename → 409.
- **API key prefix collision** (cosmetic) → service rotates the prefix and retries.
- **Soft-delete with active subscription** → 409; admin must cancel the subscription first.

## Policy constants

- `SLUG_REGEX`
- `ORGANIZATION_API_KEY_RAW_SECRET_BYTE_LENGTH = 32`
- `ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH = 8`
