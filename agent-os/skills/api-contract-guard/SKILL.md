---
name: api-contract-guard
description: Enforces the core-be public API contract conventions — snake_case route params, prefixed public ids, the uniform method→status policy, and the header naming matrix — across routes, validators, tests, OpenAPI/Postman docs, and the route-status gates. Use when adding or changing any route, param, header, public id, or response status.
---

# API contract guard

## Route params — snake_case, semantic, entity-typed

- Every path param is snake_case and semantic: `{organization_id}`, `{plan_id}`, `{session_id}`, `{upload_id}`, `{auth_method_id}`, … — never `{id}` or camelCase.
- Param names must exist in `PARAM_NAME_TO_ENTITY` (src/shared/utils/identity/public-id.util.ts) so validators, test materializers, and OpenAPI docs derive the entity automatically.
- Zod params-DTO object keys must equal the route param name exactly.

## Public ids — Paddle-style prefixed

- Format: `<prefix>_<21 chars of [a-z0-9]>` (e.g. `org_a1b2c3d4e5f6g7h8i9j0k`); prefixes live in `PUBLIC_ID_PREFIXES`.
- `generatePublicId(entity)` requires the entity; never hand-roll ids. Externally the field is always `id` — the words "public id/publicId" never appear in documentation.
- New tables: widen `public_id` to varchar(28), add the prefix to the map, the migration backfill, and the OpenAPI parameter docs come free via the map.

## Method → success status (enforced by middleware)

| GET | POST | PUT/PATCH | DELETE |
|-----|------|-----------|--------|
| 200 | 201  | 200       | 204    |

Exceptions (protocol-owned, stay 200): `POST /billing/webhook`, `POST /billing/stripe/webhook`, `POST /api/v1/mcp`.
The policy is enforced centrally in `method-status-policy.middleware.ts`; declared statuses live in `tooling/openapi/route-catalog/route-success-statuses.json` and are runtime-verified by `pnpm validate:route-success-coverage` (drift fails CI).

## Error status — when to set which (full guide: docs/reference/api/response-codes.md)

- **400** request shape invalid (body/param/query fails Zod, malformed JSON, webhook signature) — per-field `details`; documented on every POST/PATCH/PUT; only a param-less, query-less GET/DELETE documents **no 400** at all.
- **401** missing/expired/revoked access token — message must tell the developer how to recover (login → `Authorization: Bearer <ACCESS_TOKEN>`).
- **403** authenticated but lacking permission/role. **404** id or route doesn't exist (incl. other-org ids — no existence leak).
- **406** MCP only (Accept negotiation).
- **409** mutating only — state conflict: duplicate resource, bad state transition, in-flight duplicate Idempotency-Key.
- **413 / 415** POST/PATCH/PUT only — body too large / wrong Content-Type.
- **422** mutating only — business-rule rejection, or Idempotency-Key reused with a different payload.
- **429** every route — with `Retry-After` + `X-RateLimit-*` headers.
- **500** never intentional — the never-5xx fuzz gate fails CI on any 5xx from malformed input.
- Rules of thumb: 400 = malformed shape, 422 = valid shape wrong meaning; 409 = conflicts with current state, 422 = payload logic always wrong. Never invent a status outside this list.

## Header matrix (client-sent)

- `Authorization: Bearer <ACCESS_TOKEN>` — every authed route (OpenAPI security scheme; Postman collection-level bearer `{{ACCESS_TOKEN}}`).
- `Content-Type: application/json` — any body.
- `X-Organization-Id` — org-scoped routes; optional when the path carries `{organization_id}` (must match when both present).
- `Idempotency-Key` — all mutating routes (optional, auto-generate in clients); REQUIRED on the 8 writes registered with `config.idempotencyRequired: true` (org create, memberships, transfer-ownership, invitations, subscription create/change-plan/cancel/resume).
- `X-Captcha-Token` — public auth forms only (login, magic-link send, password forgot/reset, email verify, webauthn authenticate options, oauth authorize).
- `X-CSRF-Token` — POST /auth/refresh only (double-submit of the csrf_token cookie). Keeps the X- form (frontend-framework default).
- `Stripe-Signature` — sent BY Stripe to the webhook routes; the app never sends it.

## Headers kept in X- form (ecosystem standards)

`X-Request-Id`, `X-Client-Request-Id`, `X-Api-Key`, `X-CSRF-Token`, `X-RateLimit-*` (server-emitted with `Retry-After` on 429), Helmet's security headers, `X-Forwarded-For`. Custom headers use the X- form for visual consistency with the infrastructure headers: `X-Organization-Id`, `X-Idempotency-Replay` (response marker), `X-Captcha-Token`. Standards keep their fixed names: `Authorization`, `Idempotency-Key`, `Stripe-Signature`, `Retry-After`.

## Sync checklist when touching any of the above

1. `pnpm routes:catalog` → registry key updates in `route-success-statuses.json`.
2. Response-map / examples fixture keys follow the same `METHOD /path` keys.
3. `ROUTE_EXAMPLE_CAPTURE=1 pnpm test && pnpm routes:examples` to refresh captured samples.
4. `pnpm docs:generate:multilang && pnpm docs:postman` then `pnpm docs:check`.
5. Gates: `validate:route-success-statuses`, `validate:route-success-coverage`, unit suites for the response map and examples fixture.
6. Breaking changes: `pnpm docs:breaking` (local mirror of the CI oasdiff gate); intentional breaks get narrow entries in `.github/oasdiff/breaking-changes-ignore.txt`.
