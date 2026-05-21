# Sub-domains layout (canonical)

Multi-resource domains use `src/domains/<domain>/sub-domains/`. **Aggregate children** that belong to a parent resource live in a **nested** folder:

```text
sub-domains/<parent>/<nested-child>/
```

Examples: `organization/organization-api-key/`, `membership/member-invitation/`, `webhook/webhook-event/`, `member-roles/member-role-permission/`.

## Import paths

- Top-level sub-domain: `@/domains/<domain>/sub-domains/<resource>/...`
- Nested sub-domain: `@/domains/<domain>/sub-domains/<parent>/<nested>/...`

## Event handler tests

Co-locate under `events/__tests__/` on the resource that owns the handlers (see `testing-conventions.mdc`).

## DTO rule

Every route file uses Zod DTOs from co-located `*.dto.ts`. Controllers stay thin.

## Upload content types

Validators use `getAllowedContentTypesForPurpose()` so `UPLOAD_ALLOW_SVG` controls whether SVG is allowed on image purposes. Organization logos reject SVG at attach time for security.

For the full domain map, see [CLAUDE.md](../../../CLAUDE.md) and [domains-and-public-api-design.md](./domains-and-public-api-design.md).
