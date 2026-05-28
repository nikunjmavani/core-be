---
name: route-catalog
description: Generates a docs/routes.txt file listing every API route grouped by domain with HTTP method, full path, and access control (public, authenticated, global role, org permission). Use after adding, removing, or updating any route in src/domains/.
---

# Route Catalog Generator

Produces **`docs/routes.txt`** — a single-file overview of **every** HTTP route (method, path, access). Auto-generated; do not edit by hand. Tests parse this file via `@/tests/helpers/route-catalog-registry.js`.

## When to run

Run this skill **every time** you:

- Add a new route to any `*.routes.ts`
- Remove a route
- Change a route's path, method, or access control (preHandler)
- Add or remove a domain/sub-domain that registers routes

## How it works

### Step 1 — Read route sources

1. Read `src/routes.ts` to get the **prefix map** (domain → prefix, e.g. `auth → /api/v1/auth`).
2. Read every `*.routes.ts` file under `src/domains/` (use Glob `src/domains/**/*.routes.ts`).
3. For aggregator route files (e.g. `tenancy.routes.ts`) that register sub-domain route plugins without their own `app.register` prefix, note that sub-domain routes inherit the parent prefix.

### Step 2 — Parse each route

For every `app.<method>(path, ...)` call, extract:

| Field             | How to detect                                               |
| ----------------- | ----------------------------------------------------------- |
| **Method**        | `app.get`, `app.post`, `app.patch`, `app.put`, `app.delete` |
| **Relative path** | First string argument (e.g. `'/organizations/:id'`)         |
| **Access**        | Inspect the `preHandler` array in the options object        |

#### Access-level rules

| Pattern in `preHandler`                                          | Access label                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| No options / no `preHandler`                                     | `PUBLIC`                                               |
| `[app.authenticate]` only                                        | `AUTH`                                                 |
| `[app.authenticate, requireRole(GLOBAL_ROLES.X, ...)]`           | `ROLE: super_admin, admin` (list the roles)            |
| `[app.authenticate, requireOrganizationPermission(PERM.X, ...)]` | `PERM: <permission_code>` (e.g. `organization:update`) |

To resolve permission codes, look at the constant imported (e.g. `TENANCY_PERMISSIONS.ORGANIZATION_UPDATE`). Map these to their string values. Common mappings:

- `TENANCY_PERMISSIONS.*` → defined in `src/domains/tenancy/tenancy.permissions.ts`
- `BILLING_PERMISSIONS.*` → defined in `src/domains/billing/billing.permissions.ts`
- `NOTIFY_PERMISSIONS.*` → defined in `src/domains/notify/notify.permissions.ts`
- `AUDIT_PERMISSIONS.*` → defined in `src/domains/audit/audit.permissions.ts`

Read the relevant `*.permissions.ts` file to resolve the actual string code.

### Step 3 — Build full path

Concatenate the **domain prefix** (from `src/routes.ts`) + **sub-domain prefix** (if any `app.register` in the aggregator adds one) + **relative path**.

Example: prefix `/api/v1/tenancy` + relative path `/organizations/:id/settings` = `/api/v1/tenancy/organizations/:id/settings`.

### Step 4 — Write `docs/routes.txt`

Use this exact format:

```text
================================================================================
  ROUTE CATALOG — core-be
  Total routes: <count>
================================================================================

Legend:
  PUBLIC  = No authentication required
  AUTH    = JWT authentication required
  ROLE    = Global role required (super_admin, admin, user)
  PERM    = Organization-scoped permission required

================================================================================
  DOMAIN: AUTH (/api/v1/auth)
  Routes: <count>
================================================================================

  POST   /api/v1/auth/login                                     PUBLIC
  POST   /api/v1/auth/logout                                    PUBLIC
  ...
  POST   /api/v1/auth/password/change                           AUTH
  ...

================================================================================
  DOMAIN: USER (/api/v1/users)
  Routes: <count>
================================================================================

  GET    /api/v1/users/                                         ROLE: super_admin, admin
  ...
  GET    /api/v1/users/me                                       AUTH
  ...

================================================================================
  DOMAIN: TENANCY (/api/v1/tenancy)
  Routes: <count>
================================================================================

  — Organization —
  GET    /api/v1/tenancy/organizations                          AUTH
  PATCH  /api/v1/tenancy/organizations/:id                      PERM: organization:update
  ...

  — Membership —
  GET    /api/v1/tenancy/organizations/:id/memberships          PERM: membership:read
  ...

  — Member Roles —
  ...

  — Permissions —
  ...

================================================================================
  DOMAIN: BILLING (/api/v1/billing)
  Routes: <count>
================================================================================

  — Plans —
  GET    /api/v1/billing/plans                                  PUBLIC
  ...

  — Subscriptions —
  ...

================================================================================
  SUMMARY
================================================================================

  Total routes  : <count>
  Public        : <count>
  Authenticated : <count>
  Role-guarded  : <count>
  Perm-guarded  : <count>
```

### Formatting rules

- **Method** column: left-aligned, padded to 6 chars wide (e.g. `GET` padded to `GET___`, `DELETE` already 6 chars; underscores show where spaces go)
- **Path** column: left-aligned, padded to align access labels (use at least 55 chars width)
- **Access** column: right-aligned label
- Group routes within a domain by sub-domain using `— Sub-domain Name —` dividers
- Within each group, order routes by path alphabetically, then by method (GET, POST, PATCH, PUT, DELETE)
- Include a summary section at the end with counts

## Output

`pnpm routes:catalog` writes both artifacts (implemented in `src/scripts/codegen/generate-route-catalog.ts`):

- `docs/routes.txt` — human-readable catalog (checked into version control)

`pnpm routes:catalog:check` fails if either file is out of sync with route sources.

## Follow-up (same PR)

After updating `docs/routes.txt`:

1. **route-schema-doc-guard** — add/update `schema: { summary, description, tags }` on the Fastify route registration. (The legacy **openapi-route-sync** skill is preserved for compatibility but the canonical authoring is route-schema-doc-guard.)
2. **openapi-multilingual** — add tag translations to all locales when a new tag is introduced; run `pnpm docs:generate:multilang`.
3. **seed-maintainer** — align seeds when routes were added or removed.
4. **test-generator** — domain e2e tests for new/changed routes.
5. **feature-doc-maintainer** — refresh per-folder `DOCS.md` and run the strict ratchet.
